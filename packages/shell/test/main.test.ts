import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
    createShell: vi.fn(),
    mkdirSync: vi.fn(),
    storePaths: [] as string[],
    fileConfigSource: vi.fn((path: string) => ({ kind: "config", path })),
    fileReportSink: vi.fn((path: string) => ({ kind: "reports", path })),
    stubbedExternals: vi.fn((overrides: unknown) => ({ kind: "externals", overrides })),
    toEngine: vi.fn((capability: unknown) => ({ engine: capability })),
    dataUrls: [] as string[],
}));

vi.mock("node:fs", () => ({ mkdirSync: fakes.mkdirSync }));
vi.mock("node:url", () => ({
    fileURLToPath: (url: URL) => {
        fakes.dataUrls.push(String(url));
        return "C:\\shell-data\\";
    },
}));
vi.mock("@hiero-hackers/automation-core", () => ({ toEngine: fakes.toEngine }));
vi.mock("@hiero-hackers/automation-store", () => ({
    Store: class {
        constructor(path: string) {
            fakes.storePaths.push(path);
        }
    },
}));
vi.mock("@hiero-hackers/automation-probes", () => ({
    inactivity: "inactivity",
    intake: "intake",
    prQuality: "prQuality",
}));
vi.mock("../src/shell.js", () => ({ createShell: fakes.createShell }));
vi.mock("../src/config.js", () => ({
    CONFIG_PATH: "automations.yml",
    fileConfigSource: fakes.fileConfigSource,
}));
vi.mock("../src/reports.js", () => ({ fileReportSink: fakes.fileReportSink }));
vi.mock("../src/externals.js", () => ({ stubbedExternals: fakes.stubbedExternals }));

const ENV_KEYS = [
    "WEBHOOK_SECRET",
    "REPO_OWNER",
    "REPO_NAME",
    "CONFIG_FILE",
    "REPORTS_FILE",
    "STORE_PATH",
    "PORT",
    "KILL_SWITCH",
] as const;

const originalEnvironment = new Map<string, string | undefined>();

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fakes.storePaths.length = 0;
    fakes.dataUrls.length = 0;
    for (const key of ENV_KEYS) {
        originalEnvironment.set(key, process.env[key]);
        delete process.env[key];
    }
});

afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ENV_KEYS) {
        const value = originalEnvironment.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    originalEnvironment.clear();
});

function validEnvironment(): void {
    process.env["WEBHOOK_SECRET"] = "secret";
    process.env["REPO_OWNER"] = "owner";
    process.env["REPO_NAME"] = "repo";
}

function shellDouble(drain: () => Promise<void> = async () => {}): {
    drain: () => Promise<void>;
    server: { listen: ReturnType<typeof vi.fn> };
} {
    return {
        drain: vi.fn(drain),
        server: {
            listen: vi.fn((_port: number, ready: () => void) => ready()),
        },
    };
}

describe("sandbox entry point", () => {
    it.each(["WEBHOOK_SECRET", "REPO_OWNER", "REPO_NAME"] as const)(
        "fails closed when %s is absent",
        async (missing) => {
            validEnvironment();
            delete process.env[missing];
            const error = vi.spyOn(console, "error").mockImplementation(() => {});
            vi.spyOn(process, "exit").mockImplementation((() => {
                throw new Error("exit 1");
            }) as never);

            await expect(import("../src/main.js")).rejects.toThrow("exit 1");
            expect(process.exit).toHaveBeenCalledWith(1);
            expect(error).toHaveBeenCalledWith(
                "WEBHOOK_SECRET, REPO_OWNER and REPO_NAME are required (the sandbox App's secret and the repository this endpoint serves).",
            );
            expect(fakes.createShell).not.toHaveBeenCalled();
        },
    );

    it("uses fail-closed defaults and starts recovery before listening", async () => {
        validEnvironment();
        const order: string[] = [];
        const shell = shellDouble(async () => {
            order.push("drain");
        });
        shell.server.listen.mockImplementation((_port: number, ready: () => void) => {
            order.push("listen");
            ready();
        });
        fakes.createShell.mockReturnValue(shell);
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        await import("../src/main.js");

        expect(fakes.mkdirSync).toHaveBeenCalledWith("C:\\shell-data\\", {
            recursive: true,
        });
        expect(fakes.dataUrls).toEqual([expect.stringContaining("/data/")]);
        expect(fakes.storePaths).toEqual(["C:\\shell-data\\shell.sqlite"]);
        expect(fakes.fileConfigSource).toHaveBeenCalledWith(
            "C:\\shell-data\\automations.yml",
        );
        expect(fakes.fileReportSink).toHaveBeenCalledWith(
            "C:\\shell-data\\decisions.jsonl",
        );
        expect(fakes.stubbedExternals).toHaveBeenCalledWith({
            killSwitchActive: false,
        });
        expect(fakes.createShell).toHaveBeenCalledWith(
            expect.objectContaining({
                secret: "secret",
                repository: { owner: "owner", repo: "repo" },
                capabilities: [
                    { engine: "intake" },
                    { engine: "prQuality" },
                    { engine: "inactivity" },
                ],
            }),
        );
        expect(shell.server.listen).toHaveBeenCalledWith(8790, expect.any(Function));
        expect(log).toHaveBeenCalledWith(
            "shell listening on :8790 for owner/repo (config copy of automations.yml: C:\\shell-data\\automations.yml); reports land in C:\\shell-data\\decisions.jsonl",
        );
        expect(order).toEqual(["drain", "listen"]);
    });

    it("honors every explicit path, port, and kill-switch setting", async () => {
        validEnvironment();
        Object.assign(process.env, {
            CONFIG_FILE: "C:\\config.yml",
            REPORTS_FILE: "C:\\reports.jsonl",
            STORE_PATH: "C:\\store.sqlite",
            PORT: "4312",
            KILL_SWITCH: "1",
        });
        const shell = shellDouble();
        fakes.createShell.mockReturnValue(shell);
        vi.spyOn(console, "log").mockImplementation(() => {});

        await import("../src/main.js");

        expect(fakes.storePaths).toEqual(["C:\\store.sqlite"]);
        expect(fakes.fileConfigSource).toHaveBeenCalledWith("C:\\config.yml");
        expect(fakes.fileReportSink).toHaveBeenCalledWith("C:\\reports.jsonl");
        expect(fakes.stubbedExternals).toHaveBeenCalledWith({
            killSwitchActive: true,
        });
        expect(shell.server.listen).toHaveBeenCalledWith(4312, expect.any(Function));
    });

    it("surfaces startup-drain failure without claiming success", async () => {
        validEnvironment();
        const failure = new Error("drain failed");
        fakes.createShell.mockReturnValue(shellDouble(async () => {
            throw failure;
        }));
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});

        await import("../src/main.js");
        await new Promise<void>((resolve) => queueMicrotask(resolve));

        expect(error).toHaveBeenCalledWith(
            "shell: startup drain failed; deliveries remain pending",
            failure,
        );
    });
});
