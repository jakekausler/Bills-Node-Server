import { load, save } from './io';
import { Categories } from './types';

const FILE_NAME = 'categories';

export function loadCategories() {
  return load<Categories>(`${FILE_NAME}.json`);
}

export function saveCategories(data: Categories) {
  save<Categories>(data, `${FILE_NAME}.json`);
}
