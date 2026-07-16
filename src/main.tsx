import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './style.css';

// No StrictMode: the D3 map layer appends to its <svg> imperatively on init,
// and StrictMode's dev double-invocation would duplicate the scene graph.
createRoot(document.getElementById('root')!).render(<App />);
