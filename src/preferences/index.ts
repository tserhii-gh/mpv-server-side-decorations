import type Adw from 'gi://Adw';

import {General} from '../preferences/pages/general.js';

export const pages = (): Adw.PreferencesPage[] => [
    new General(),
];
