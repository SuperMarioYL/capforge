Output assets/demo.gif

Set Shell "bash"
Set FontSize 15
Set Width 1180
Set Height 600

# fresh throwaway store + promote target so the run is reproducible
Type "export CAPFORGE_HOME=$HOME/.capforge-demo CLAUDE_SKILLS_DIR=$HOME/.claude-demo/skills" Sleep 200ms Enter
Type "rm -rf $HOME/.capforge-demo $HOME/.claude-demo" Sleep 100ms Enter

# 1. init — keypair + store + config
Type "capforge init" Sleep 1500ms Enter

# 2. forge — observe -> synthesize -> test -> sign -> provenance
Type "capforge forge --task examples/task-slugify.json --mock" Sleep 4000ms Enter

# 3. list — capability store with test + sig badges
Type "capforge list" Sleep 1500ms Enter

# 4. verify — test-pass + signature-valid on the forged skill
Type "capforge verify $(ls $HOME/.capforge-demo/skills | head -1)" Sleep 1500ms Enter

# 5. promote — copy the signed skill into the agent's permanent skill surface
Type "capforge promote $(ls $HOME/.capforge-demo/skills | head -1)" Sleep 2500ms Enter

Sleep 500ms
