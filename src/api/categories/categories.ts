import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadCategories, saveCategories } from '../../utils/io/categories';

export function getCategories(_request: Request) {
	return loadCategories();
}

export function addCategory(request: Request) {
	const data = getData(request);
	const categories = loadCategories();
	const path = data.path;

	if (path.length === 0 || path.length > 2) {
		return { error: 'Invalid path' };
	}

	if (path.length === 1) {
		const section = path[0];
		if (!(section in categories)) {
			categories[section] = [];
		}
	} else {
		const section = path[0];
		const item = path[1];
		if (!(section in categories)) {
			categories[section] = [item];
		} else {
			categories[section].push(item);
			categories[section] = categories[section]
				.sort()
				.filter((value: string, index: number, self: string[]) => self.indexOf(value) === index);
		}
	}

	saveCategories(categories);
	return categories;
}

export function deleteCategory(request: Request) {
	const data = getData(request);
	const categories = loadCategories();
	const path = data.path;

	if (path.length === 0 || path.length > 2) {
		return { error: 'Invalid path' };
	}

	if (path.length === 1) {
		const section = path[0];
		if (section in categories) {
			delete categories[section];
		}
	} else {
		const section = path[0];
		const item = path[1];
		if (section in categories && item in categories[section]) {
			categories[section].splice(categories[section].indexOf(item), 1);
		}
	}

	saveCategories(categories);
	return categories;
}
