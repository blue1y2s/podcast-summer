import { formatFileSize } from '../lib/utils';

export function FilePicker({
  text,
  selectedFile,
  onSelectFile,
  onClearFile
}) {
  function handleInputChange(event) {
    const [file] = event.target.files || [];
    if (file) {
      onSelectFile(file);
    }
    event.target.value = '';
  }

  function handleDrop(event) {
    event.preventDefault();
    const [file] = event.dataTransfer.files || [];
    if (file) {
      onSelectFile(file);
    }
  }

  function preventDefault(event) {
    event.preventDefault();
  }

  return (
    <div className="space-y-3">
      <div
        className="rounded-[18px] border border-dashed border-white/15 bg-black/10 p-4"
        onDragEnter={preventDefault}
        onDragOver={preventDefault}
        onDrop={handleDrop}
      >
        <p className="text-sm font-semibold text-neutral-content">
          {selectedFile ? text.fileReady : text.fileIdle}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <label className="btn btn-sm rounded-xl border-white/12 bg-white/10 text-neutral-content hover:bg-white/16">
            {text.chooseFile}
            <input
              type="file"
              className="hidden"
              accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac,.mp4,.webm"
              onChange={handleInputChange}
            />
          </label>
          {selectedFile ? (
            <button
              type="button"
              className="btn btn-sm rounded-xl border-white/12 bg-white/10 text-neutral-content hover:bg-white/16"
              onClick={onClearFile}
            >
              {text.clearFile}
            </button>
          ) : null}
        </div>
      </div>

      {selectedFile ? (
        <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-4">
          <div className="eyebrow-inverse">{text.fileLabel}</div>
          <p className="mt-2 break-all text-sm font-semibold text-neutral-content">{selectedFile.name}</p>
          <p className="mt-1 text-xs text-neutral-content/60">{formatFileSize(selectedFile.size)}</p>
        </div>
      ) : null}
    </div>
  );
}
