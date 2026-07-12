# examples

A real `task.json` you can forge right now.

```bash
capforge init
capforge forge --task examples/task-slugify.json --mock
capforge verify <id-printed-above>
capforge ui   # click Promote
```

`task-slugify.json` asks capforge to synthesize a skill that slugifies a string.
The mock synthesizer (used because no API key is set) produces a POSIX shell
wrapper that passes the assertion on every example input. Run the same command
without `--mock` (and with `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set) to have
your own model synthesize the skill.

The shape of a task:

| field | meaning |
|---|---|
| `goal` | what the agent failed to do |
| `available_tools` | tools the agent already has (Bash, Read, …) |
| `available_skills` | skills already installed (helps the synthesizer avoid dupes) |
| `example_inputs` | inputs the forged skill will be tested against |
| `expected_assert` | shell; exit 0 with `INPUT`/`OUTPUT`/`EXIT` env = pass |
