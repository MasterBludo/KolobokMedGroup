import { spawn } from "child_process";

interface PythonCommand {
  command: string;
  args: string[];
}

export function getPythonCommandCandidates(
  platform: NodeJS.Platform,
  configuredExecutable?: string
): PythonCommand[] {
  const configured = configuredExecutable?.trim().replace(/^["']|["']$/g, "");
  if (configured) {
    return [{ command: configured, args: [] }];
  }

  return platform === "win32"
    ? [
        { command: "python", args: [] },
        { command: "py", args: ["-3"] },
      ]
    : [
        { command: "python3", args: [] },
        { command: "python", args: [] },
      ];
}

export function runPythonScript(
  scriptPath: string,
  filePath: string,
  configuredExecutable?: string,
  platform: NodeJS.Platform = process.platform
): Promise<string> {
  const commands = getPythonCommandCandidates(platform, configuredExecutable);
  const pythonArgs = [scriptPath, "--text-only", filePath];

  return new Promise((resolve, reject) => {
    const tryCommand = (index: number) => {
      const candidate = commands[index];
      const child = spawn(candidate.command, [...candidate.args, ...pythonArgs], {
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      });
      let output = "";
      let errorOutput = "";
      let settled = false;

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (output += chunk));
      child.stderr.on("data", (chunk: string) => (errorOutput += chunk));
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        if (error.code === "ENOENT" && index + 1 < commands.length) {
          settled = true;
          tryCommand(index + 1);
          return;
        }

        settled = true;
        if (error.code === "ENOENT") {
          reject(
            new Error(
              "Python не найден. Установите Python 3 и зависимости командой `python -m pip install -r requirements.txt` (в Windows можно использовать `py -3 -m pip install -r requirements.txt`). Если Python установлен в отдельной среде, задайте PYTHON_EXECUTABLE в .env."
            )
          );
          return;
        }
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(errorOutput.trim() || `OCR завершился с кодом ${code}`));
        }
      });
    };

    tryCommand(0);
  });
}
