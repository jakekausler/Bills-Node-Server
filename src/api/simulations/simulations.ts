import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadSimulations, saveSimulations } from '../../utils/io/simulation';
import { Simulations } from '../../utils/simulation/types';
import { formatDate } from '../../utils/date/date';

export async function getSimulations(_request: Request) {
  return loadSimulations().map((simulation) => ({
    name: simulation.name,
    enabled: simulation.enabled,
    selected: simulation.selected,
    variables: Object.fromEntries(
      Object.entries(simulation.variables).map(([key, value]) => [
        key,
        {
          value: value.type === 'date' ? formatDate(value.value as Date) : value.value,
          type: value.type,
        },
      ]),
    ),
  }));
}

export async function updateSimulations(request: Request) {
  const data = await getData<Simulations>(request);
  saveSimulations(data.data);
  return data.data;
}
