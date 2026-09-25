import { json } from '@codemirror/lang-json';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { useDarkMode } from '../hooks';

const extensions = [json(), EditorView.lineWrapping];

export function JsonEditor({ value, onChange, readOnly, minHeight = '120px', maxHeight, label }: { value: string; onChange?: (value: string) => void; readOnly?: boolean; minHeight?: string; maxHeight?: string; label: string }) {
  const dark = useDarkMode();
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        editable={!readOnly}
        theme={dark ? 'dark' : 'light'}
        extensions={extensions}
        minHeight={minHeight}
        maxHeight={maxHeight}
        basicSetup={{ foldGutter: !readOnly, highlightActiveLine: !readOnly, highlightActiveLineGutter: !readOnly }}
        aria-label={label}
      />
    </div>
  );
}
