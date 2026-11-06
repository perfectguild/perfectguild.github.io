import {formatDate, formatNumber, localizeDocument, t} from './i18n.mjs';

// Owner-confirmed names use the zero-based rank index from the Armory snapshot.
const confirmedGuildRankKeys = {
  1: 'card.rankOfficer',
  2: 'card.rankWanderer',
  3: 'card.rankRaider',
};
const imageDuration = 6;
const emptyImages = [];

function joinDetails(first, second) {
  return first && second ? `${first} · ${second}` : first || second || '';
}

function writeLine(element, text) {
  element.textContent = text;
  element.hidden = !text;
}

function writeBinding(element, character) {
  const kind = character.binding?.kind;
  const confirmed = kind === 'owner-confirmed-url';
  writeLine(element, confirmed ? t('card.confirmed') : kind === 'name-match' ? t('card.nameMatch') : '');
  element.title = confirmed
    ? t('card.confirmedHelp', {date: formatDate(character.binding.confirmedOn)})
    : kind === 'name-match' ? t('card.nameMatchHelp') : '';
}

function rankText(character) {
  const rankKey = confirmedGuildRankKeys[character.guildRank?.index];
  return rankKey ? t(rankKey) : character.guildRank?.name || (character.guildRank?.index != null
    ? t('card.rankNumber', {value: formatNumber(character.guildRank.index)}) : '');
}

function classText(character) {
  return joinDetails(character.className, character.level != null
    ? t('card.level', {value: formatNumber(character.level)}) : '');
}

function statsText(character, itemLevelKind) {
  return joinDetails(character.itemLevel != null
    ? t(itemLevelKind === 'average' ? 'card.averageItemLevel' : 'card.itemLevel',
      {value: formatNumber(character.itemLevel)}) : '',
  character.achievementPoints != null
    ? t('card.achievements', {value: formatNumber(character.achievementPoints)}) : '');
}

function writeArmoryLink(element, character) {
  element.hidden = !character.profileUrl;
  if (character.profileUrl) {
    element.href = character.profileUrl;
    element.setAttribute('aria-label', t('card.armoryLabel', {name: character.characterName}));
  } else {
    element.removeAttribute('href');
    element.removeAttribute('aria-label');
  }
}


export function createCharacterCard({snapshot, forum, onLayout, reducedMotion = false}) {
  const characters = new Map(snapshot.characters.map(character => [character.id, character]));
  const groups = new Map();
  for (const group of snapshot.characterGroups || []) {
    for (const nicknameId of group.nicknameIds) groups.set(nicknameId, group);
  }
  const profiles = new Map();
  for (const profile of forum.profiles) {
    if (profile.nicknameId !== null) profiles.set(profile.nicknameId, profile);
  }
  const element = document.getElementById('character-card');
  element.hidden = true;
  element.setAttribute('aria-describedby', 'card-group-confirmation card-binding card-description card-source');
  element.innerHTML = `
    <header class="card-header">
      <div class="card-heading">
        <h2 id="character-name" aria-live="polite"></h2>
        <span id="card-role" class="card-role" hidden></span>
        <span id="card-character-position" class="card-character-position" hidden></span>
        <span id="card-binding" class="card-binding"></span>
      </div>
      <button id="close-card" type="button" data-i18n-aria-label="card.closeLabel" data-i18n-title="card.closeLabel">
        <!-- MDI window-close, @mdi/svg 7.4.47, Apache-2.0; see LICENSE-mdi.txt. -->
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M13.46,12L19,17.54V19H17.54L12,13.46L6.46,19H5V17.54L10.54,12L5,6.46V5H6.46L12,10.54L17.54,5H19V6.46L13.46,12Z"/>
        </svg>
      </button>
    </header>
    <p id="card-group-confirmation" class="card-group-confirmation" data-i18n="card.groupConfirmed" hidden></p>
    <div class="card-content">
      <figure class="card-photo" hidden>
        <a id="forum-image-link" target="_blank" rel="noopener noreferrer">
          <img id="forum-image" width="68" height="68" draggable="false" alt="">
        </a>
        <figcaption>
          <span id="forum-name" data-i18n-title="card.forumName" hidden></span>
          <span id="forum-image-position" hidden></span>
        </figcaption>
      </figure>
      <div id="card-description" class="card-description">
        <p id="card-class"></p>
        <p id="card-race"></p>
        <p id="card-rank" class="card-rank" data-i18n-title="card.rankTitle"></p>
        <p id="card-stats" class="card-stats" data-i18n-title="card.statsTitle"></p>
      </div>
    </div>
    <p id="card-source" class="card-source">
      <a id="armory-link" target="_blank" rel="noopener noreferrer" data-i18n="card.armory"></a>
      <span id="card-no-armory" data-i18n="card.noArmory" hidden></span>
      <span id="card-realm"></span>
      <time id="card-snapshot-date"></time>
      <a id="forum-profile-link" target="_blank" rel="noopener noreferrer" data-i18n="card.forum" hidden></a>
    </p>
    <p id="card-outdated" class="card-note" data-i18n="card.outdated" hidden></p>
    <button id="card-previous-character" class="card-character-nav card-character-previous" type="button"
      data-i18n-aria-label="card.previousCharacter" data-i18n-title="card.previousCharacter" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15.4 5.4 8.8 12l6.6 6.6-1.4 1.4-8-8 8-8Z"/></svg>
    </button>
    <button id="card-next-character" class="card-character-nav card-character-next" type="button"
      data-i18n-aria-label="card.nextCharacter" data-i18n-title="card.nextCharacter" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m8.6 4 8 8-8 8-1.4-1.4 6.6-6.6-6.6-6.6Z"/></svg>
    </button>
  `;
  localizeDocument(element);
  element.setAttribute('aria-label', t('card.title'));
  const title = element.querySelector('#character-name');
  const roleBadge = element.querySelector('#card-role');
  const characterPosition = element.querySelector('#card-character-position');
  const binding = element.querySelector('#card-binding');
  const groupConfirmation = element.querySelector('#card-group-confirmation');
  const content = element.querySelector('.card-content');
  const photo = element.querySelector('.card-photo');
  const photoLink = element.querySelector('#forum-image-link');
  const photoImage = element.querySelector('#forum-image');
  const forumName = element.querySelector('#forum-name');
  const imagePosition = element.querySelector('#forum-image-position');
  const classLine = element.querySelector('#card-class');
  const raceLine = element.querySelector('#card-race');
  const rankLine = element.querySelector('#card-rank');
  const statsLine = element.querySelector('#card-stats');
  const armoryLink = element.querySelector('#armory-link');
  const noArmory = element.querySelector('#card-no-armory');
  const realm = element.querySelector('#card-realm');
  const date = element.querySelector('#card-snapshot-date');
  const forumLink = element.querySelector('#forum-profile-link');
  const outdated = element.querySelector('#card-outdated');
  const previousCharacter = element.querySelector('#card-previous-character');
  const nextCharacter = element.querySelector('#card-next-character');
  date.dateTime = snapshot.observedOn;
  date.textContent = formatDate(snapshot.observedOn);
  date.title = t('card.snapshotDate', {date: date.textContent});

  let selectedKey = null;
  let selectedGroup = null;
  let singleLabel = '';
  let memberIds = [];
  let memberIndex = 0;
  let profile = null;
  let images = emptyImages;
  let imageIndex = 0;
  let elapsed = 0;
  let moving = false;
  let disposed = false;

  function paintImage() {
    const image = images[imageIndex];
    photo.hidden = !image;
    content.classList.toggle('has-forum-image', Boolean(image));
    if (!image) {
      photoLink.removeAttribute('href');
      photoLink.removeAttribute('aria-label');
      photoLink.removeAttribute('title');
      photoImage.removeAttribute('src');
      photoImage.alt = '';
      writeLine(imagePosition, '');
      return;
    }
    const position = images.length > 1
      ? t('card.imagePosition', {index: formatNumber(imageIndex + 1), count: formatNumber(images.length)}) : '';
    const label = joinDetails(t('card.openImage'), position);
    photoLink.href = image.url;
    photoLink.title = label;
    photoLink.setAttribute('aria-label', label);
    // There are deliberately no asynchronous decode callbacks: a hidden or replaced
    // selection cannot be overwritten by completion of an earlier image request.
    photoImage.src = reducedMotion && image.stillUrl ? image.stillUrl : image.url;
    photoImage.alt = joinDetails(t('card.imageAlt', {name: profile.forumName}), position);
    writeLine(imagePosition, position);
  }

  function paintCharacter() {
    const character = characters.get(memberIds[memberIndex]);
    const label = selectedGroup ? character.characterName : singleLabel;
    title.textContent = label;
    element.setAttribute('aria-label', t('card.label', {name: label}));
    roleBadge.hidden = !selectedGroup;
    roleBadge.textContent = selectedGroup
      ? t(selectedGroup.members[memberIndex].role === 'main' ? 'card.main' : 'card.alt') : '';
    writeLine(characterPosition, memberIds.length > 1
      ? t('card.characterPosition', {index: formatNumber(memberIndex + 1), count: formatNumber(memberIds.length)}) : '');
    writeBinding(binding, character);
    writeLine(classLine, classText(character));
    writeLine(raceLine, joinDetails(character.race, character.specialization));
    writeLine(rankLine, rankText(character));
    writeLine(statsLine, statsText(character, snapshot.itemLevelKind));
    writeArmoryLink(armoryLink, character);
    noArmory.hidden = Boolean(character.profileUrl);
    writeLine(realm, character.realm || '');
    outdated.hidden = !character.isOutdated;
  }

  function switchCharacter(direction) {
    if (disposed || memberIds.length < 2) return;
    memberIndex = (memberIndex + direction + memberIds.length) % memberIds.length;
    paintCharacter();
    element.scrollTop = 0;
    onLayout?.();
  }

  function showPreviousCharacter() {
    switchCharacter(-1);
  }

  function showNextCharacter() {
    switchCharacter(1);
  }

  previousCharacter.addEventListener('click', showPreviousCharacter);
  nextCharacter.addEventListener('click', showNextCharacter);

  return {
    element,
    show(nickname) {
      if (disposed) return;
      const group = groups.get(nickname.id);
      const key = group ? `group:${group.id}` : `character:${nickname.id}`;
      if (key === selectedKey) {
        element.hidden = false;
        return;
      }
      selectedKey = key;
      selectedGroup = group || null;
      singleLabel = nickname.label;
      memberIds = group ? group.members.map(member => member.characterId) : [nickname.id];
      memberIndex = 0;
      profile = profiles.get(nickname.id) || (group && group.nicknameIds.map(id => profiles.get(id)).find(Boolean)) || null;
      images = profile?.images || emptyImages;
      imageIndex = 0;
      elapsed = 0;
      moving = false;
      const hasAlts = memberIds.length > 1;
      element.classList.toggle('has-character-navigation', hasAlts);
      previousCharacter.hidden = !hasAlts;
      nextCharacter.hidden = !hasAlts;
      groupConfirmation.hidden = group?.evidenceKind !== 'owner-confirmed';
      groupConfirmation.title = groupConfirmation.hidden ? ''
        : t('card.groupConfirmedHelp', {date: formatDate(group.confirmedOn)});
      paintCharacter();
      writeLine(forumName, profile && profile.forumName !== nickname.label ? profile.forumName : '');
      paintImage();
      forumLink.hidden = !profile?.archiveProfileUrl;
      if (profile?.archiveProfileUrl) forumLink.href = profile.archiveProfileUrl;
      else forumLink.removeAttribute('href');
      element.scrollTop = 0;
      element.hidden = false;
    },
    hide() {
      element.hidden = true;
      moving = false;
    },
    setReducedMotion(enabled) {
      if (disposed || reducedMotion === enabled) return;
      reducedMotion = enabled;
      if (enabled) moving = false;
      paintImage();
    },
    advance(deltaSeconds, active) {
      moving = !disposed && !element.hidden && active && !reducedMotion && images.length > 1;
      if (!moving) return false;
      if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
        elapsed += deltaSeconds;
        if (elapsed >= imageDuration) {
          const steps = Math.floor(elapsed / imageDuration);
          elapsed %= imageDuration;
          const nextIndex = (imageIndex + steps) % images.length;
          if (nextIndex !== imageIndex) {
            imageIndex = nextIndex;
            paintImage();
          }
        }
      }
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      moving = false;
      element.hidden = true;
      previousCharacter.removeEventListener('click', showPreviousCharacter);
      nextCharacter.removeEventListener('click', showNextCharacter);
      photoImage.removeAttribute('src');
      photoLink.removeAttribute('href');
    },
  };
}
