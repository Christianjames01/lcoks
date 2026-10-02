import { Camera, ImagePlus, Trash } from 'lucide-react';
import { useState } from 'react';
import { PhotoError, pickCardPhoto } from '../lib/photo';
import { errorMessage } from '../lib/api';

/**
 * Edit-form control for a card photo (front or back). The photo is stored
 * encrypted with the item; in the form it is shown blurred until tapped.
 */
export function CardPhotoField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peek, setPeek] = useState(false);

  const pick = async (source: 'camera' | 'gallery') => {
    setBusy(true);
    setError(null);
    try {
      const data = await pickCardPhoto(source);
      if (data) {
        onChange(data);
        setPeek(false);
      }
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id={id} className="photo-field">
      {value ? (
        <button
          type="button"
          className={`photo-preview ${peek ? '' : 'blurred'}`}
          onClick={() => setPeek((p) => !p)}
          aria-label={peek ? 'Hide photo' : 'Show photo'}
          title={peek ? 'Tap to hide' : 'Tap to show'}
        >
          <img src={value} alt="" />
          {!peek && <span className="photo-hint">Hidden · tap to show</span>}
        </button>
      ) : (
        <div className="photo-empty">No photo yet</div>
      )}
      <div className="row-flex" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="btn sm" onClick={() => void pick('camera')} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden /> : <Camera size={14} aria-hidden />} {value ? 'Retake' : 'Take photo'}
        </button>
        <button type="button" className="btn sm" onClick={() => void pick('gallery')} disabled={busy}>
          <ImagePlus size={14} aria-hidden /> Choose photo
        </button>
        {value && (
          <button type="button" className="btn sm ghost" onClick={() => onChange('')} disabled={busy}>
            <Trash size={14} aria-hidden /> Remove
          </button>
        )}
      </div>
      {error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
