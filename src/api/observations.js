import { http } from './http.js'

export const listObservations = () => http.get('/api/observations')
export const deleteObservation = id => http.del(`/api/observations/${encodeURIComponent(id)}`)
export const clearObservations = () => http.del('/api/observations')
export function saveObservation(entry, location, memo) {
  const { serverSaved, observationLocation, observationMemo, savedAt, ...analysis } = entry
  return http.put(`/api/observations/${encodeURIComponent(entry.id)}`, {
    json: { location: location.trim(), memo: memo.trim(), analysis },
  })
}
