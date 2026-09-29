import type { DocumentInfo } from "../platform";
import { formatShortcut } from "../commands/shortcuts";
import { Icon } from "./icons";

interface Props {
  recent: DocumentInfo[];
  onOpen: () => void;
  onOpenRecent: (doc: DocumentInfo) => void;
}

export function Welcome({ recent, onOpen, onOpenRecent }: Props) {
  return (
    <main className="welcome">
      <h1>Tourmaline</h1>
      <p className="muted">
        Open a PDF with the button below, File › Open, or <kbd>{formatShortcut("Mod+O")}</kbd>. Every command is also
        in the command palette (<kbd>{formatShortcut("Mod+K")}</kbd>).
      </p>
      <button type="button" className="button primary" onClick={onOpen}>
        <Icon name="open" /> Open PDF…
      </button>
      {recent.length > 0 && (
        <section aria-labelledby="recent-heading" className="recent">
          <h2 id="recent-heading">Recent</h2>
          <ul>
            {recent.map((doc) => (
              <li key={doc.id}>
                <button type="button" className="recent-item" onClick={() => onOpenRecent(doc)} title={doc.path ?? undefined}>
                  <Icon name="file" />
                  <span className="recent-name">{doc.name}</span>
                  <span className="recent-path muted">{doc.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
