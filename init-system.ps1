$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  Write-Host "`n==> $Name" -ForegroundColor Cyan
  & $Action
}

$repoRoot = $PSScriptRoot
Set-Location $repoRoot

Invoke-Step -Name 'Stop existing compose stacks' -Action {
  docker compose -f webapp/docker-compose.yml down --remove-orphans
  docker compose -f docker-compose.mock.yml down --remove-orphans
}

Invoke-Step -Name 'Generate data and mock-HIS seed' -Action {
  python scripts/generate_hospital_data.py
  python scripts/generate_vaccine_data.py
  python scripts/generate_mock_his_seed.py
  python scripts/compute_road_distance.py
}

Invoke-Step -Name 'Start webapp stack' -Action {
  docker compose -f webapp/docker-compose.yml build vaccine-engine backend frontend
  docker compose -f webapp/docker-compose.yml up -d
}

Invoke-Step -Name 'Start standalone mock-HIS stack' -Action {
  docker compose -f docker-compose.mock.yml up -d --build
}

Write-Host "`nVacFlow initialization complete." -ForegroundColor Green