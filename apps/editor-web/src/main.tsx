import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PresenterView } from './components/Present';
import './styles.css';

const presenter = location.hash === '#/presenter';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{presenter ? <PresenterView /> : <App />}</StrictMode>,
);
