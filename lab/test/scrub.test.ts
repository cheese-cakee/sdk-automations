/**
 * The scrubber is the one piece of the lab that MUST be right before it is
 * ever used: a leak ships a sandbox identifier into a tracked fixture, and
 * git history does not forget. So it is tested like core code — including
 * the property that matters most, which is not "identifiers are gone" but
 * "structure survives": fixtures exist to feed the normalizer, and a
 * scrubbed payload that lost its referential structure tests nothing.
 */

import { describe, expect, it } from "vitest";
import { scrubPayload } from "../src/scrub.js";

const payload = {
    action: "opened",
    issue: {
        id: 3111222333,
        node_id: "I_kwDOAbc123",
        number: 7,
        title: "Login fails on retry",
        user: { login: "owner-sandbox", id: 998877, email: "owner@real.example.com" },
        assignee: { login: "owner-sandbox", id: 998877 },
        html_url: "https://github.com/owner-sandbox/scratch-repo/issues/7",
    },
    repository: {
        id: 445566,
        node_id: "R_kgDOXyz789",
        name: "scratch-repo",
        full_name: "owner-sandbox/scratch-repo",
        owner: { login: "owner-sandbox", id: 998877 },
        labels_url: "https://api.github.com/repos/owner-sandbox/scratch-repo/labels{/name}",
    },
    label: { id: 11, name: "status: triage" },
    sender: { login: "owner-sandbox", id: 998877 },
    installation: { id: 71234567, node_id: "MDIzOkludGVn" },
} as const;

const result = scrubPayload(payload) as any;

describe("identifiers leave", () => {
    it("no login, repo name, node_id, or email survives anywhere", () => {
        const text = JSON.stringify(result);
        for (const secret of [
            "owner-sandbox",
            "scratch-repo",
            "I_kwDOAbc123",
            "R_kgDOXyz789",
            "MDIzOkludGVn",
            "owner@real.example.com",
            "998877",
            "71234567",
        ]) {
            expect(text, `leaked: ${secret}`).not.toContain(secret);
        }
    });
});

describe("structure survives", () => {
    it("the same account is still the same account everywhere", () => {
        expect(result.issue.user.login).toBe(result.sender.login);
        expect(result.issue.assignee.login).toBe(result.repository.owner.login);
        expect(result.issue.user.id).toBe(result.sender.id);
    });

    it("URLs still contain the login and repo the payload names", () => {
        expect(result.issue.html_url).toContain(result.sender.login);
        expect(result.repository.labels_url).toContain(result.repository.name);
        // And the URL template survives untouched.
        expect(result.repository.labels_url).toContain("{/name}");
    });

    it("full_name is still owner/name", () => {
        expect(result.repository.full_name).toBe(
            `${result.repository.owner.login}/${result.repository.name}`,
        );
    });

    it("content the normalizer reads is untouched", () => {
        expect(result.action).toBe("opened");
        expect(result.issue.number).toBe(7);
        expect(result.issue.title).toBe("Login fails on retry");
        // A label's name is workflow content, not identity — the whole
        // point of the mapping layer is that these strings matter.
        expect(result.label.name).toBe("status: triage");
    });

    it("is deterministic", () => {
        expect(scrubPayload(payload)).toEqual(result);
    });
});
