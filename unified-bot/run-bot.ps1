# Executa o bot IPTV (PowerShell)
param([string[]]$Args)
node "$PSScriptRoot/index.js" @Args
