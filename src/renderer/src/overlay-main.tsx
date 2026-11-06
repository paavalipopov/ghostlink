import { createRoot } from 'react-dom/client'
import { Overlay } from './Overlay'

document.documentElement.style.background = 'transparent'
document.body.style.background = 'transparent'

createRoot(document.getElementById('root')!).render(<Overlay />)
