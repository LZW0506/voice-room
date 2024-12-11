import { createRoot } from 'react-dom/client'
import App from './App'
import store from './store'
import { Provider } from 'react-redux'
import './i18n'
createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <App />
  </Provider>
)
