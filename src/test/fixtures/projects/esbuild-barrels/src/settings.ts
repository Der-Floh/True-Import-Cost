import throttle from 'kit/throttle.js';
import { Card, Select } from './components';

export const openSettings = throttle(() => `${Card()} ${Select()}`, 50);
