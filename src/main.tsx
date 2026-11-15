import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { applyTextSize, readTextSize } from './lib/textSize';

// Applied before render so a person who chose large text never sees one frame
// of the small one — that flash is disorienting and looks like a glitch.
applyTextSize(readTextSize(localStorage), document.documentElement);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
