import { Feather } from 'lucide-react';
import './brand.css';

export function Brand() {
  return (
    <div className="brand">
      <span className="icon-tile" aria-hidden="true"><Feather size={19} strokeWidth={1.8} /></span>
      Kuroko
    </div>
  );
}
