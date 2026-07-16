import { createRoot } from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import './index.css';
import './style.css';

// No StrictMode: the D3 map layer appends to its <svg> imperatively on init,
// and StrictMode's dev double-invocation would duplicate the scene graph.
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <TooltipProvider delayDuration={350}>
      <App />
    </TooltipProvider>
  </ThemeProvider>,
);
