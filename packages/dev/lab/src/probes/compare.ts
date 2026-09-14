/** A recorded `a:read|b:read` (alternatives) of `a:read+b:read` (all) against GitHub's `a=read; b=read` header. */
export function permissionAccepted(recorded: string, header: string): boolean {
    const grants = (text: string, sep: string): string[][] =>
        text.split(sep).map((alt) =>
            alt
                .split(/[+,]/)
                .map((g) => g.trim().replace(":", "="))
                .sort(),
        );
    const offered = grants(header, ";");
    return grants(recorded, "|").some((need) =>
        offered.some((have) => need.every((g) => have.includes(g))),
    );
}
