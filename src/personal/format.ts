export const shortDate = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);
