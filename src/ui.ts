import type { MissionConfig } from './data/data';

const $lobbyOverlay = document.getElementById('lobby-overlay');
let $missionButtons: HTMLElement[];
const $statusText = document.getElementById('lobby-status');

export function setStatusText(message: string) {
  $statusText.innerText = message;
}

export function enableMissionButtons() {
  $missionButtons.forEach((button: HTMLButtonElement) => {
    button.disabled = false;
  });
}

export function disableMissionButtons() {
  $missionButtons.forEach((button: HTMLButtonElement) => {
    button.disabled = false;
  });
}

export function hideLobbyOverlay() {
  $lobbyOverlay.style.display = 'none';
}

export function buildMissionButtons(missions: MissionConfig[], selectMission) {
  const container = document.getElementById('mission-buttons');
  if (!container) return;

  container.innerHTML = '';
  missions.forEach((missionConfig) => {
    const button = document.createElement('button');
    button.className = 'sector-btn mission-btn';
    button.type = 'button';
    button.textContent = missionConfig.name.toUpperCase();
    button.dataset.mission = missionConfig.id;
    button.addEventListener('click', () => selectMission(missionConfig.id));
    container.appendChild(button);
  });
  $missionButtons = Array.from(document.querySelectorAll<HTMLElement>('.mission-btn'));
}
