import { useLayoutEffect, useRef, useState } from 'react';

export default function LayerNameEditor({ name, onFinish }) {
  const [value, setValue] = useState(name);
  const input = useRef(null);
  const finished = useRef(false);
  useLayoutEffect(() => { input.current.focus(); input.current.select(); }, []);
  const finish = save => {
    if (finished.current) return;
    finished.current = true;
    onFinish(save ? value.trim() || name : name);
  };
  return <input ref={input} className="layer-name-input" aria-label="图层名称" maxLength={100}
    value={value} onChange={event => setValue(event.target.value)} onClick={event => event.stopPropagation()}
    onBlur={() => finish(true)} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault(); finish(event.key === 'Enter');
      }
    }} />;
}
