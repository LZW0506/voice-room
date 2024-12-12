import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import 'virtual:svg-icons-register'
import App from './App'
import './locales'
import store from './store'
import './styles/main.css'
createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <App />
  </Provider>
)
