import './i18n';
import { syncUiLocaleToMain } from './i18n';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

syncUiLocaleToMain();

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<App />);
}
