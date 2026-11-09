import {formatDate, formatNumber, localizeDocument, t} from './i18n.mjs';

const imageDuration = 6;
const emptyImages = [];

function joinDetails(first, second) {
  return first && second ? `${first} · ${second}` : first || second || '';
}

function writeLine(element, text) {
  element.textContent = text;
  element.hidden = !text;
}

function writeBinding(element, character, nickname) {
  if (nickname?.characterId) {
    const evidence = nickname.evidence;
    const confirmed = evidence.kind === 'owner-confirmed-character';
    writeLine(element, t(confirmed ? 'card.aliasConfirmed' : 'card.noteAlias'));
    element.title = confirmed
      ? t('card.aliasConfirmedHelp', {name: nickname.label, note: evidence.note, date: formatDate(evidence.confirmedOn)})
      : t('card.noteAliasHelp', {name: nickname.label, note: evidence.note, image: formatNumber(evidence.image)});
    return;
  }
  const kind = character.binding?.kind;
  const confirmed = kind === 'owner-confirmed-url';
  if (kind === 'owner-confirmed-character') {
    writeLine(element, t('card.characterConfirmed'));
    element.title = t('card.characterConfirmedHelp', {date: formatDate(character.binding.confirmedOn)});
    return;
  }
  if (kind === 'owner-confirmed-forum-avatar') {
    writeLine(element, t('card.forumAvatarConfirmed'));
    element.title = t('card.forumAvatarHelp', {date: formatDate(character.binding.confirmedOn)});
    return;
  }
  if (kind === 'archive-forum-name' || kind === 'archive-character') {
    writeLine(element, t('card.forumArchiveBinding'));
    element.title = t('card.forumArchiveHelp');
    return;
  }
  writeLine(element, confirmed ? t('card.confirmed') : kind === 'name-match' ? t('card.nameMatch')
    : kind === 'in-game-roster' ? t('card.rosterBinding') : '');
  element.title = confirmed
    ? t('card.confirmedHelp', {date: formatDate(character.binding.confirmedOn)})
    : kind === 'name-match' ? t('card.nameMatchHelp')
    : kind === 'in-game-roster' ? t('card.rosterBindingHelp') : '';
}

function rankText(character) {
  return character.rosterObservation?.rankKey ? t(character.rosterObservation.rankKey)
    : character.guildRank?.name || (character.guildRank?.index != null
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
  (character.achievementPoints ?? character.rosterObservation?.achievementPoints) != null
    ? t('card.achievements', {value: formatNumber(character.achievementPoints ?? character.rosterObservation.achievementPoints)}) : '');
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
  element.dataset.controlsStyle = 'round';
  element.setAttribute('aria-describedby', 'card-group-confirmation card-collage-label card-binding card-description card-declarations card-image-attribution card-source');
  element.innerHTML = `
    <header class="card-header">
      <div class="card-heading">
        <h2 id="character-name" aria-live="polite"></h2>
        <span id="card-role" class="card-role" hidden></span>
        <span id="card-character-position" class="card-character-position" hidden></span>
        <span id="card-binding" class="card-binding"></span>
      </div>
      <button id="close-card" class="card-control" type="button" data-i18n-aria-label="card.closeLabel" data-i18n-title="card.closeLabel">
        <!-- MDI window-close, @mdi/svg 7.4.47, Apache-2.0; see LICENSE-mdi.txt. -->
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M13.46,12L19,17.54V19H17.54L12,13.46L6.46,19H5V17.54L10.54,12L5,6.46V5H6.46L12,10.54L17.54,5H19V6.46L13.46,12Z"/>
        </svg>
      </button>
    </header>
    <p id="card-group-confirmation" class="card-group-confirmation" hidden></p>
    <p id="card-collage-label" class="card-group-confirmation" hidden></p>
    <p id="card-forum-context" class="card-group-confirmation" hidden></p>
    <div class="card-body">
      <button id="card-previous-character" class="card-control card-character-nav card-character-previous" type="button"
        data-i18n-aria-label="card.previousCharacter" data-i18n-title="card.previousCharacter" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path transform="translate(1.3 0)" d="M15.4 5.4 8.8 12l6.6 6.6-1.4 1.4-8-8 8-8Z"/></svg>
      </button>
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
      <button id="card-next-character" class="card-control card-character-nav card-character-next" type="button"
        data-i18n-aria-label="card.nextCharacter" data-i18n-title="card.nextCharacter" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path transform="translate(22.7 0) scale(-1 1)" d="M15.4 5.4 8.8 12l6.6 6.6-1.4 1.4-8-8 8-8Z"/></svg>
      </button>
    </div>
    <p id="card-image-attribution" class="card-note" hidden></p>
    <div id="card-declarations" class="card-declarations" hidden></div>
    <p id="card-source" class="card-source">
      <a id="armory-link" target="_blank" rel="noopener noreferrer" data-i18n="card.armory"></a>
      <span id="card-no-armory" data-i18n="card.noArmory" hidden></span>
      <span id="card-realm"></span>
      <time id="card-snapshot-date"></time>
      <a id="forum-profile-link" target="_blank" rel="noopener noreferrer" data-i18n="card.forum" hidden></a>
      <a id="forum-evidence-link" target="_blank" rel="noopener noreferrer" data-i18n="card.forumEvidence" hidden></a>
      <a id="character-history-link" target="_blank" rel="noopener noreferrer" data-i18n="card.characterHistory" hidden></a>
    </p>
    <p id="card-outdated" class="card-note" data-i18n="card.outdated" hidden></p>
    <div class="card-character-pagination" hidden></div>
  `;
  localizeDocument(element);
  element.setAttribute('aria-label', t('card.title'));
  const title = element.querySelector('#character-name');
  const roleBadge = element.querySelector('#card-role');
  const characterPosition = element.querySelector('#card-character-position');
  const binding = element.querySelector('#card-binding');
  const groupConfirmation = element.querySelector('#card-group-confirmation');
  const collageLabel = element.querySelector('#card-collage-label');
  const forumContext = element.querySelector('#card-forum-context');
  const declarations = element.querySelector('#card-declarations');
  const imageAttribution = element.querySelector('#card-image-attribution');
  const body = element.querySelector('.card-body');
  const pagination = element.querySelector('.card-character-pagination');
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
  const forumEvidenceLink = element.querySelector('#forum-evidence-link');
  const historyLink = element.querySelector('#character-history-link');
  const outdated = element.querySelector('#card-outdated');
  const previousCharacter = element.querySelector('#card-previous-character');
  const nextCharacter = element.querySelector('#card-next-character');

  let selectedKey = null;
  let selectedGroup = null;
  let selectedNickname = null;
  let memberIds = [];
  let memberIndex = 0;
  let profile = null;
  let images = emptyImages;
  let imageIndex = 0;
  let elapsed = 0;
  let moving = false;
  let disposed = false;
  const selections = new Map();

  function paintImage() {
    const fallback = images.length === 0;
    const image = fallback ? forum.defaultImage : images[imageIndex];
    photo.hidden = false;
    content.classList.add('has-forum-image');
    writeLine(imageAttribution, image?.attributionKind === 'member-number-only' ? t('card.numberOnlyImage') : '');
    const position = images.length > 1
      ? t('card.imagePosition', {index: formatNumber(imageIndex + 1), count: formatNumber(images.length)}) : '';
    const label = fallback ? t('card.openGuildImage') : joinDetails(t('card.openImage'), position);
    photoLink.href = image.url;
    photoLink.title = label;
    photoLink.setAttribute('aria-label', label);
    // There are deliberately no asynchronous decode callbacks: a hidden or replaced
    // selection cannot be overwritten by completion of an earlier image request.
    photoImage.src = reducedMotion && image.stillUrl ? image.stillUrl : image.url;
    photoImage.alt = fallback ? t('card.guildImageAlt')
      : joinDetails(t('card.imageAlt', {name: profile.forumName}), position);
    writeLine(imagePosition, position);
  }

  function paintCharacter() {
    const character = characters.get(memberIds[memberIndex]);
    const label = selectedGroup || selectedNickname.characterId ? character.characterName : selectedNickname.label;
    title.textContent = label;
    element.setAttribute('aria-label', t('card.label', {name: label}));
    const memberRole = selectedGroup?.members[memberIndex].role;
    roleBadge.hidden = !selectedGroup || memberRole === 'related';
    const inference = selectedGroup?.roleInference;
    roleBadge.textContent = memberRole === 'main' ? t(inference ? 'card.inferredMain' : 'card.main')
      : memberRole === 'alt' ? t(inference ? 'card.inferredAlt' : 'card.alt') : '';
    roleBadge.title = inference
      ? t('card.rankInferenceHelp', {date: formatDate(inference.assessedOn)}) : '';
    writeLine(characterPosition, memberIds.length > 1
      ? t('card.characterPosition', {index: formatNumber(memberIndex + 1), count: formatNumber(memberIds.length)}) : '');
    writeBinding(binding, character, selectedNickname);
    writeLine(classLine, classText(character));
    writeLine(raceLine, joinDetails(character.race, character.specialization));
    writeLine(rankLine, rankText(character));
    rankLine.title = character.rosterObservation ? t('card.rosterRankHelp') : t('card.rankTitle');
    writeLine(statsLine, statsText(character, snapshot.itemLevelKind));
    statsLine.title = character.achievementPoints == null && character.rosterObservation
      ? t('card.rosterStatsHelp') : t('card.statsTitle');
    const fromGame = character.binding?.kind === 'in-game-roster';
    classLine.title = fromGame ? t('card.rosterBindingHelp') : '';
    const historical = character.recordKind === 'historical-character' || character.recordKind === 'historical-nickname';
    const forumAvatar = character.binding?.kind === 'owner-confirmed-forum-avatar';
    const forumArchive = character.binding?.kind === 'archive-forum-name';
    const fromForum = forumAvatar || forumArchive;
    const ownerCharacter = character.binding?.kind === 'owner-confirmed-character';
    const withoutSnapshot = historical || fromForum || ownerCharacter;
    date.hidden = withoutSnapshot;
    const observedOn = character.observedOn || snapshot.observedOn;
    if (fromGame || withoutSnapshot) date.removeAttribute('datetime');
    else date.dateTime = observedOn;
    date.textContent = withoutSnapshot ? '' : fromGame ? t('card.rosterSource') : formatDate(observedOn);
    date.title = withoutSnapshot ? '' : fromGame ? t('card.rosterBindingHelp') : t('card.snapshotDate', {date: date.textContent});
    const historyUrl = historical ? character.binding?.sourceUrl : null;
    historyLink.hidden = !historyUrl || historyUrl === profile?.archiveProfileUrl
      || historyUrl === profile?.evidenceUrl || historyUrl === selectedGroup?.evidenceUrl;
    if (historyUrl) historyLink.href = historyUrl;
    else historyLink.removeAttribute('href');
    writeArmoryLink(armoryLink, character);
    noArmory.hidden = Boolean(character.profileUrl);
    noArmory.textContent = historical || fromForum || ownerCharacter ? t('card.noArmoryBinding') : t('card.noArmory');
    writeLine(realm, historical ? '' : character.realm || '');
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
      const key = nickname.characterId || group?.members[0].role === 'related' ? `nickname:${nickname.id}`
        : group ? `group:${group.id}` : `character:${nickname.id}`;
      if (key === selectedKey) {
        element.hidden = false;
        return;
      }
      if (selectedKey) selections.set(selectedKey, {memberIndex, imageIndex, elapsed});
      selectedKey = key;
      selectedGroup = group || null;
      selectedNickname = nickname;
      const characterId = nickname.characterId || nickname.id;
      memberIds = group ? group.members.map(member => member.characterId) : [characterId];
      memberIndex = group?.members[0].role === 'related'
        ? Math.max(0, group.members.findIndex(member => member.characterId === characterId)) : 0;
      const saved = selections.get(key);
      if (saved) memberIndex = saved.memberIndex;
      profile = profiles.get(nickname.id) || profiles.get(characterId)
        || (group && group.nicknameIds.map(id => profiles.get(id)).find(Boolean)) || null;
      images = profile?.images || emptyImages;
      imageIndex = saved?.imageIndex || 0;
      elapsed = saved?.elapsed || 0;
      moving = false;
      const hasAlts = memberIds.length > 1;
      element.classList.toggle('has-character-navigation', hasAlts);
      previousCharacter.hidden = !hasAlts;
      nextCharacter.hidden = !hasAlts;
      pagination.hidden = !hasAlts || element.dataset.controlsStyle !== 'footer';
      groupConfirmation.hidden = !group;
      const archiveGroup = group?.evidenceKind === 'archive-self-report';
      groupConfirmation.replaceChildren();
      if (archiveGroup) {
        const link = document.createElement('a');
        link.href = group.evidenceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = t('card.groupArchive', {date: formatDate(group.capturedOn)});
        groupConfirmation.append(link);
      } else {
        groupConfirmation.textContent = group?.evidenceKind === 'in-game-roster-note'
          ? t('card.groupRoster') : t('card.groupConfirmed');
        if (group?.evidenceUrl) {
          const link = document.createElement('a');
          link.href = group.evidenceUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = t('card.groupArchiveSource', {date: formatDate(group.capturedOn)});
          groupConfirmation.append(' · ', link);
        }
      }
      groupConfirmation.title = !group ? '' : archiveGroup ? t('card.groupArchiveHelp')
        : group.evidenceKind === 'in-game-roster-note'
          ? t(group.roleInference ? 'card.groupRankInferenceHelp' : 'card.groupRosterHelp') : group.evidence?.length
            ? t('card.groupMixedHelp', {date: formatDate(group.confirmedOn)})
            : t('card.groupConfirmedHelp', {date: formatDate(group.confirmedOn)});
      writeLine(collageLabel, nickname.characterId ? t('card.collageLabel', {name: nickname.label}) : '');
      paintCharacter();
      writeLine(forumName, images.length && profile.forumName !== nickname.label ? profile.forumName : '');
      writeLine(forumContext, profile && !images.length ? t('card.forumContext', {name: profile.forumName}) : '');
      declarations.replaceChildren();
      const historicalDeclarations = profile?.historicalDeclarations || [];
      declarations.hidden = historicalDeclarations.length === 0;
      for (const declaration of historicalDeclarations) {
        const line = document.createElement('p');
        const link = document.createElement('a');
        link.href = declaration.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = t('card.declarationSource', {date: formatDate(declaration.capturedOn)});
        line.append(t(declaration.relation === 'declared-character' ? 'card.declaredCharacter' : 'card.previouslyMentioned',
          {name: declaration.characterName}), ' ', link);
        declarations.append(line);
      }
      paintImage();
      const forumSourceUrl = profile?.archiveProfileUrl || profile?.evidenceUrl;
      forumLink.hidden = !forumSourceUrl;
      forumLink.textContent = t(profile?.archiveProfileUrl ? 'card.forum' : 'card.forumEvidence');
      if (forumSourceUrl) forumLink.href = forumSourceUrl;
      else forumLink.removeAttribute('href');
      const extraEvidence = profile?.archiveProfileUrl && profile.evidenceUrl !== forumSourceUrl
        && profile.evidenceUrl !== group?.evidenceUrl
        && !historicalDeclarations.some(declaration => declaration.sourceUrl === profile.evidenceUrl)
        ? profile.evidenceUrl : null;
      forumEvidenceLink.hidden = !extraEvidence;
      if (extraEvidence) forumEvidenceLink.href = extraEvidence;
      else forumEvidenceLink.removeAttribute('href');
      element.scrollTop = 0;
      element.hidden = false;
    },
    hide() {
      element.hidden = true;
      moving = false;
    },
    setControlsStyle(style) {
      if (disposed || element.dataset.controlsStyle === style) return;
      element.dataset.controlsStyle = style;
      // Move the existing controls, preserving the selected alt and listeners.
      if (style === 'footer') {
        pagination.append(previousCharacter, characterPosition, nextCharacter);
      } else {
        body.prepend(previousCharacter);
        body.append(nextCharacter);
        binding.before(characterPosition);
      }
      pagination.hidden = style !== 'footer' || memberIds.length < 2;
      onLayout?.();
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
