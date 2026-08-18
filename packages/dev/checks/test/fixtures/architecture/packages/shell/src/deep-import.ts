// no-import-past-the-barrel: a relative path that climbs out of one package
// and lands past another's public export.
export { secret } from "../../store/src/private.js";
