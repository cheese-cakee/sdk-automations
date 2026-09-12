// no-import-past-the-barrel: a relative path that climbs out of one barrel's
// territory and lands past the neighbouring one's public export.
export { secret } from "../store/private.js";
