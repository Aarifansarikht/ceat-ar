import ARExperience from './components/ARExperience.jsx';
import { trackingConfig } from './ar/trackingConfig.js';

export default function App() {
  return <ARExperience config={trackingConfig} />;
}
