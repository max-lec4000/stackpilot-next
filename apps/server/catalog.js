import {readFileSync} from 'node:fs';
export const catalog=JSON.parse(readFileSync(new URL('../../packages/catalog/services.json',import.meta.url),'utf8'));
