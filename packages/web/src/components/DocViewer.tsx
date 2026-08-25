import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * A document viewer, shown over the page.
 *
 * The interaction is the one the other Brown Family Sports sites use, because a
 * reader who has opened a document on one of them should not have to work out a
 * new one here: a scrim you can click, Escape to dismiss, and a bar carrying the
 * title, an escape hatch to a real tab, and a download.
 *
 * Portaled to <body> rather than rendered in place. The console's panels carry
 * backdrop-filter, and a filtered ancestor becomes the containing block for
 * fixed positioning — the overlay would be trapped inside the card that opened
 * it, sized to that card, and clipped by its notch.
 */
export function DocViewer({
  title,
  src,
  onClose,
}: {
  title: string;
  src: string;
  onClose: () => void;
}): React.JSX.Element | null {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // The page behind is still scrollable otherwise, so a trackpad flick over
    // the scrim moves the thing the reader is not looking at.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="dv" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="dv__scrim" aria-label="Close document" onClick={onClose} />

      <div className="dv__box">
        <div className="dv__bar">
          <span className="dv__title">{title}</span>
          <span className="dv__actions">
            <a href={src} target="_blank" rel="noreferrer noopener">
              Open in a tab ↗
            </a>
            <a href={src} download>
              Download
            </a>
            <button type="button" className="small dv__close" onClick={onClose}>
              Close
            </button>
          </span>
        </div>

        {/*
          An <iframe> rather than an <embed>: the browser's own PDF viewer comes
          with page controls and text selection, and a reader who wants to zoom
          into a date on a certificate should get the tool they already know.
        */}
        <iframe className="dv__frame" src={src} title={title} />
      </div>
    </div>,
    document.body,
  );
}
