/**
 * Shared markdown rendering helpers for the saved conversation format, plus
 * the transformer for prompt blocks the host injects into user messages.
 *
 * The code-span and callout helpers are the document format's building
 * blocks (see index.ts's header comment for how the saved file is
 * assembled). The injected-block transformer below re-renders the
 * machine-readable XML the Claudian client and the agent runtime append to
 * user message text: raw, that markup is noise notes apps cannot render —
 * unknown tags are not HTML and CDATA is XML — so every block in a known
 * vocabulary becomes a readable callout, and anything unknown stays verbatim
 * so XML a user pasted as content is never mangled.
 */

// ---------- code spans & callouts ----------

/**
 * Inline code span for arbitrary raw output (tool results, argument JSON):
 * the delimiter is always one backtick longer than the longest backtick run
 * inside the text, so content that itself contains backticks cannot break
 * the span. Tool output renders literally instead of being parsed as
 * markdown (headings, bold, wiki links …).
 */
export function inlineCode(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((a, r) => Math.max(a, r.length), 0);
  const fence = "`".repeat(longest + 1);
  return `${fence}${text}${fence}`;
}

/**
 * Obsidian callout (`> [!type]- title`) wrapping a markdown body: every body
 * line is prefixed with `>` (empty lines become bare `>`), so the body keeps
 * rendering as markdown while folding works in both Obsidian views. Outside
 * Obsidian the callout degrades to a plain blockquote. An empty body renders
 * the title alone.
 */
export function callout(type: string, title: string, body: string, fold = true): string {
  const header = `> [!${type}]${fold ? "-" : ""} ${title}`;
  if (!body) return header;
  const lines = body.split("\n").map((line) => (line ? `> ${line}` : ">"));
  return `${header}\n${lines.join("\n")}`;
}

// ---------- client-injected prompt blocks ----------

/**
 * Injected-block vocabulary, harvested from the Claudian bundle's own
 * block-stripping regexes and from observed sessions. Membership decides
 * visibility only — rendering itself is fully generic (no per-tag format
 * logic):
 *
 * - Visible: user-provided material. Selections of every surface
 *   (editor/canvas/browser), the current note, attached files, and note
 *   references (linked_note / linked_content — the client's attachment
 *   mechanism; a typed @-mention stays as plain text in the message, these
 *   are the machine copy).
 * - Hidden: agent-side traces (loaded skills) — rendered as a folded
 *   `> [!note]- Skill · <name>` marker with the name riding the title
 *   (which skill was loaded is the marker's whole meaning and must survive
 *   the collapsed view), the content dropped (a skill is re-loadable from
 *   its location).
 *
 * Unknown tags are left verbatim: this is both the safety boundary against
 * mangling pasted XML and a soft failure mode for future client tags (they
 * stay raw until the vocabulary is extended).
 */
const VISIBLE_TAGS = [
  "editor_selection",
  "editor_cursor",
  "current_note",
  "context_files",
  "canvas_selection",
  "browser_selection",
  "linked_note",
  "linked_content",
] as const;
const HIDDEN_TAGS = new Set<string>(["skill"]);
const ALL_TAGS = [...VISIBLE_TAGS, ...HIDDEN_TAGS];

/**
 * One injected block, in the grammar the client itself uses: a self-closing
 * `<tag attrs/>` or a paired `<tag attrs>content</tag>` (content may be a
 * CDATA section). Attribute values never contain raw `<`, `>` or `"` — the
 * client XML-escapes them — which is what the attribute group relies on.
 */
const INJECTED_BLOCK_RE = new RegExp(
  `<(${ALL_TAGS.join("|")})\\b((?:\\s[^<>]*?)?)(?:/>|>([\\s\\S]*?)</\\1\\s*>)`,
  "g",
);

/** "editor_selection" → "Editor Selection" — the display title of a tag. */
function tagTitle(tag: string): string {
  return tag
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Decode the XML entities the client escapes attribute values with. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (m, d: string) => {
      try {
        return String.fromCodePoint(Number(d));
      } catch {
        return m;
      }
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // last: "&amp;lt;" must not double-decode
}

/** Attribute pairs of an injected block, in source order. */
function parseAttrs(attrs: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const m of attrs.matchAll(/([a-zA-Z_][a-zA-Z0-9_.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out.push({ name: m[1], value: decodeEntities(m[2] ?? m[3] ?? "") });
  }
  return out;
}

/**
 * Unwrap the client's CDATA wrapper and reverse its `]]>` split-escaping
 * (the client rewrites a literal `]]>` inside a selection as
 * `]]]]><![CDATA[>`). Content without a CDATA wrapper passes through
 * unchanged (linked_note names, raw bodies).
 */
function unwrapCDATA(content: string): string {
  const m = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(content);
  return m ? m[1].replace(/\]\]\]\]><!\[CDATA\[>/g, "]]>") : content;
}

/**
 * Whether a value is a vault-relative note path: no leading slash or home
 * marker, no drive colon or wikilink-hostile characters, and shaped like a
 * note (a folder or a .md extension). Values that fail — absolute
 * filesystem paths, plain names, anything else — stay in code spans.
 */
function isVaultNotePath(value: string): boolean {
  return (
    value.length > 0 &&
    !/^[~/]/.test(value) &&
    !/[:\r\n[\]|#^<>]/.test(value) &&
    (/\.md$/i.test(value) || value.includes("/"))
  );
}

/** Vault path as a wikilink, aliased to its basename when it has folders. */
function wikilinkOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base && base !== path ? `[[${path}|${base}]]` : `[[${path}]]`;
}

/** Whether an attribute renders as a bare wikilink (a vault-shaped path/location). */
function isWikilinkAttr(p: { name: string; value: string }): boolean {
  return (p.name === "path" || p.name === "location") && isVaultNotePath(p.value);
}

/**
 * Attribute pairs of one injected block as body items: a `path`/`location`
 * value shaped like a vault-relative note path becomes a BARE wikilink —
 * no `**name**:` prefix, because the aliased filename is self-explanatory
 * (the file is user-provided material) and the label only adds noise — and
 * sorts first, so the reference leads the line; every other attribute stays
 * a labeled `**name**: value` item in source order.
 */
function attrItems(attrs: string): string[] {
  const pairs = parseAttrs(attrs);
  return [
    ...pairs.filter(isWikilinkAttr).map((p) => wikilinkOf(p.value)),
    ...pairs.filter((p) => !isWikilinkAttr(p)).map((p) => `**${p.name}**: ${inlineCode(p.value)}`),
  ];
}

/**
 * Hidden block as its own self-contained marker callout: the `name`
 * attribute joins the title — WHICH skill was loaded is the marker's whole
 * meaning, and a collapsed `Skill` alone would say nothing — while the
 * remaining attributes (the location) form the body and the content is
 * dropped (a skill is re-loadable from its location). A hidden block with
 * no attributes at all carries no information and is removed.
 */
function hiddenCallout(tag: string, attrs: string): string {
  const pairs = parseAttrs(attrs);
  if (pairs.length === 0) return "";
  const name = pairs.find((p) => p.name === "name")?.value;
  const body = pairs
    .filter((p) => p.name !== "name")
    .map((p) => (isWikilinkAttr(p) ? wikilinkOf(p.value) : `**${p.name}**: ${inlineCode(p.value)}`))
    .join(" · ");
  return callout("note", name ? `${tagTitle(tag)} · ${name}` : tagTitle(tag), body);
}

/**
 * One VISIBLE injected block's rendered body (no callout wrapper; hidden
 * blocks render through hiddenCallout): the attribute items, then (after a
 * blank line) the content.
 *
 * linked_note is the one content concession: its whole payload IS a note
 * reference, so content shaped like a vault note path renders as a wikilink
 * too — the same mechanical shape test, no semantics.
 */
function injectedBlockBody(tag: string, attrs: string, content: string): string {
  const attrLine = attrItems(attrs).join(" · ");
  const text = content ? unwrapCDATA(content).trim() : "";
  const body = tag === "linked_note" && isVaultNotePath(text) ? wikilinkOf(text) : text;
  return attrLine ? (body ? `${attrLine}\n\n${body}` : attrLine) : body;
}

/**
 * User message text for the saved body: every known injected block renders
 * as a preset-collapsed callout — visible blocks as `> [!quote]-`, hidden
 * blocks as a `> [!note]-` marker — and a RUN of visible same-tag blocks
 * with nothing but whitespace between them merges into ONE callout (a user
 * attaching five notes saves one Linked Content callout listing five
 * wikilinks, not five callouts; hidden markers never merge — each names its
 * own skill). Anything else stays verbatim.
 */
export function renderUserMessageText(text: string): string {
  const re = new RegExp(INJECTED_BLOCK_RE, "g");
  let out = "";
  let pos = 0;
  let runTag: string | null = null;
  const runBodies: string[] = [];
  const flushRun = () => {
    if (runTag === null) return;
    out += callout("quote", tagTitle(runTag), runBodies.join("\n\n"));
    runTag = null;
    runBodies.length = 0;
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tag = m[1];
    const gap = text.slice(pos, m.index);
    const mergeable = runTag !== null && tag === runTag && gap.trim() === "";
    if (!mergeable) {
      // A different tag, real text between the blocks, or a hidden block
      // (self-contained markers never merge) ends the run; the gap is
      // emitted only then — inside a run it is whitespace.
      flushRun();
      out += gap;
    }
    if (HIDDEN_TAGS.has(tag)) {
      out += hiddenCallout(tag, m[2]);
    } else {
      if (runTag === null) runTag = tag;
      runBodies.push(injectedBlockBody(tag, m[2], m[3] ?? ""));
    }
    pos = re.lastIndex;
  }
  flushRun();
  return out + text.slice(pos);
}

/**
 * The plain typed message: every known injected block removed and the
 * blank lines they leave behind collapsed — this is what title derivation
 * (frontmatter title, document heading, fallback filename slug) reads,
 * mirroring how the client strips the same blocks for its own titles.
 */
export function stripInjectedBlocks(text: string): string {
  return text
    .replace(INJECTED_BLOCK_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
