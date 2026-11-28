import type { ChatListItem } from '@kuroko/contracts/chat';
import { providers } from '@kuroko/contracts/connectionSettings';
import { Button, Text, UnstyledButton } from '@mantine/core';
import { useUnit } from 'effector-react';
import { ArrowRight, ArrowUpRight, ChevronRight, Globe, MessageSquare, NotebookText, Plug, UserRound } from 'lucide-react';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import cover from '../../assets/last-train.webp';
import { DiscardChangesDialog } from '../../shared/dialogs/DiscardChangesDialog';
import { useI18n } from '../../shared/i18n/i18n';
import { LibraryAvatar } from '../../shared/library/LibraryItem';
import { $chatLocked, chatOpenRequested } from '../chat/model';
import { personaAvatarUrl } from '../personas/requests';
import { RealmLink } from '../realms/RealmLink';
import { useRealmNavigation } from '../realms/useRealmNavigation';
import {
  $activeConnection, $activeInstruction, $activePersona, $recentChats, $recentRealms,
  homeClosed, homeOpened, homeRetryRequested, recentLimit, type HomeQuery,
} from './model';
import classes from './Home.module.css';

function realmAvatarSrc(id: string | undefined, hasAvatar: boolean | undefined) {
  return id && hasAvatar ? `/api/realms/${encodeURIComponent(id)}/avatar` : undefined;
}

function QueryContent<Data>({ query, retry, children }: {
  query: HomeQuery<Data>;
  retry: () => void;
  children: (data: Data) => ReactNode;
}) {
  const { t } = useI18n();
  if (query.status === 'loading') return <output className={classes.muted}>{t('home.loadingSection')}</output>;
  if (query.status === 'error') return <div className={classes.queryError}>
    <p role="alert">{t(`error.${query.code}`)}</p>
    <Button type="button" size="compact-sm" variant="default" onClick={retry}>{t('common.retryLoad')}</Button>
  </div>;
  return children(query.data);
}

function PanelHeading({ id, title, link }: {
  id: string;
  title: string;
  link?: { href: string; label: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  return <header className={classes.panelHeading}>
    <h2 id={id}>{title}</h2>
    {link && <a className={classes.panelLink} href={link.href} onClick={link.onClick}>
      {link.label}<ArrowUpRight size={16} aria-hidden="true" />
    </a>}
  </header>;
}

function RecentRow({ title, avatar, metadata, preview, disabled, onOpen }: {
  title: string; avatar: ReactNode; metadata: ReactNode; preview?: string; disabled: boolean; onOpen: () => void;
}) {
  return <li className={classes.recentRow}>
    {avatar}
    <div className={classes.rowCopy}>
      <UnstyledButton className={classes.rowOpen} type="button" disabled={disabled} onClick={onOpen}>
        <strong dir="auto">{title}</strong>
      </UnstyledButton>
      {preview && <Text dir="auto" size="sm" c="var(--kr-muted)" truncate>{preview}</Text>}
      {metadata}
    </div>
    <ChevronRight className={classes.muted} size={16} aria-hidden="true" />
  </li>;
}

function SetupRow({ icon, title, href, linkLabel, children }: {
  icon: ReactNode; title: string; href: string; linkLabel: string; children: ReactNode;
}) {
  return <div className={classes.setupRow}>
    <span className={classes.icon} aria-hidden="true">{icon}</span>
    <div className={classes.setupCopy}>
      <h3>{title}</h3>
      {children}
      <a href={href} className={classes.panelLink}>{linkLabel}<ArrowUpRight size={14} aria-hidden="true" /></a>
    </div>
  </div>;
}

export default function Home() {
  const { t, locale } = useI18n();
  const {
    chats, realms, connection, persona, instruction, enter, leave, retry, openChat, chatLocked,
  } = useUnit({
    chats: $recentChats, realms: $recentRealms, connection: $activeConnection, persona: $activePersona, instruction: $activeInstruction,
    enter: homeOpened, leave: homeClosed, retry: homeRetryRequested, openChat: chatOpenRequested, chatLocked: $chatLocked,
  });
  const realmsNavigation = useRealmNavigation();
  const [failedCover, setFailedCover] = useState<string>();

  useEffect(() => {
    enter();
    return leave;
  }, [enter, leave]);

  const chatItems = chats.status === 'ready' ? chats.data : [];
  const realmItems = realms.status === 'ready' ? realms.data : [];
  const latest = chatItems[0];
  const realmCover = realmAvatarSrc(latest?.realmId, latest?.realmHasAvatar);
  const showRealmCover = realmCover !== undefined && realmCover !== failedCover;
  const needsConnection = connection.status === 'ready' && (!connection.data || connection.data.needsKey);
  const activity = [
    ...chatItems.map((chat) => ({ ...chat, label: 'home.chatUpdated' as const })),
    ...realmItems.map((realm) => ({ ...realm, label: realm.updatedAt === realm.createdAt ? 'home.realmCreated' as const : 'home.realmUpdated' as const })),
  ].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, recentLimit);
  const activityLoading = chats.status === 'loading' || realms.status === 'loading';
  const activityError = chats.status === 'error' || realms.status === 'error';
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const time = (value: number) => <time className={classes.muted} dateTime={new Date(value).toISOString()}>{date.format(value)}</time>;
  const chatName = (title: string) => title || t('chat.untitled');

  function chatMetadata({ updatedAt, realmId, realmTitle }: ChatListItem) {
    return <span className={classes.chatMetadata}>
      {realmId && realmTitle && <RealmLink title={realmTitle}
        onClick={() => realmsNavigation.open(realmId)} disabled={realmsNavigation.disabled(realmId)} />}
      {time(updatedAt)}
    </span>;
  }

  function goToChat(id: string) {
    openChat(id);
    window.location.assign('#chat');
  }


  return <>
    <header className="page-heading">
      <h1 tabIndex={-1}>{t('home.label')}</h1>
    </header>

    <section className={classes.feature} aria-labelledby="home-feature">
      <div className={classes.featureCopy}>
        <p className={classes.featureLabel}>{t(latest ? 'home.lastChat' : 'home.roleplay')}</p>
        <h2 id="home-feature" dir="auto">{latest ? chatName(latest.title) : t('home.startTitle')}</h2>
        {latest?.lastMessage && <Text className={classes.featurePreview} dir="auto" size="sm" c="var(--kr-muted)" lineClamp={2}>
          {latest.lastMessage}
        </Text>}
        {latest && chatMetadata(latest)}
        <div className={classes.featureActions}>
          {latest ? <Button type="button" disabled={chatLocked} onClick={() => goToChat(latest.id)}
            rightSection={<ArrowRight size={16} aria-hidden="true" />}>{t('home.continueChat')}</Button>
            : <Button component="a" href="#chat" rightSection={<ArrowRight size={16} aria-hidden="true" />}>
              {t(chats.status === 'ready' ? 'home.startChat' : 'home.openChat')}
            </Button>}
          {needsConnection ? <Button component="a" href="#settings/connection" variant="default">{t('home.configureConnection')}</Button>
            : <Button component="a" href="#realms" onClick={realmsNavigation.browse} variant="default">{t('home.browseRealms')}</Button>}
        </div>
      </div>
      <img className={showRealmCover ? `${classes.featureArt} ${classes.realmCover}` : classes.featureArt}
        src={showRealmCover ? realmCover : cover} alt=""
        onError={showRealmCover ? () => setFailedCover(realmCover) : undefined} />
    </section>

    <div className={classes.columns}>
      <div className={classes.column}>
        <section className={classes.panel} aria-labelledby="home-recent-chats">
          <PanelHeading id="home-recent-chats" title={t('home.recentChats')} link={{ href: '#history', label: t('home.allChats') }} />
          <QueryContent query={chats} retry={() => retry('chats')}>{(items) => items.length ? <ul className={classes.rows}>
            {items.map((chat) => <RecentRow key={chat.id} title={chatName(chat.title)} disabled={chatLocked} onOpen={() => goToChat(chat.id)}
              avatar={<LibraryAvatar className={classes.icon} src={realmAvatarSrc(chat.realmId, chat.realmHasAvatar)}
                placeholder={<MessageSquare size={18} />} lazy />}
              metadata={chatMetadata(chat)} preview={chat.lastMessage} />)}
          </ul> : <p className={classes.muted}>{t('home.noChats')}</p>}</QueryContent>
        </section>
        <section className={classes.panel} aria-labelledby="home-recent-realms">
          <PanelHeading id="home-recent-realms" title={t('home.recentRealms')}
            link={{ href: '#realms', label: t('home.allRealms'), onClick: realmsNavigation.browse }} />
          <QueryContent query={realms} retry={() => retry('realms')}>{(items) => items.length ? <ul className={classes.rows}>
            {items.map(({ id, title, hasAvatar, updatedAt }) => <RecentRow key={id} title={title}
              disabled={realmsNavigation.disabled(id)} onOpen={() => realmsNavigation.open(id)} metadata={time(updatedAt)}
              avatar={<LibraryAvatar className={classes.icon} src={realmAvatarSrc(id, hasAvatar)}
                placeholder={<Globe size={18} />} lazy />} />)}
          </ul> : <p className={classes.muted}>{t('home.noRealms')}</p>}</QueryContent>
        </section>
      </div>

      <div className={classes.column}>
        <section className={classes.panel} aria-labelledby="home-setup">
          <PanelHeading id="home-setup" title={t('home.setup')} />
          <div className={classes.rows}>
            <SetupRow icon={<Plug size={18} />} title={t('connection.label')} href="#settings/connection"
              linkLabel={t(needsConnection ? 'home.configureConnection' : 'home.openConnection')}>
              <QueryContent query={connection} retry={() => retry('connection')}>{(active) => active ? <>
                <p className={classes.value} dir="auto">{active.name}</p>
                <p className={classes.muted} dir="auto">
                  {active.provider === 'custom' ? t('connection.custom') : providers[active.provider].label} · {active.model}
                </p>
                {active.needsKey && <p className={classes.muted}>{t('home.noConnectionKey')}</p>}
              </> : <p className={classes.muted}>{t('home.noConnection')}</p>}</QueryContent>
            </SetupRow>
            <SetupRow icon={<UserRound size={18} />} title={t('home.persona')} href="#personas" linkLabel={t('home.openPersonas')}>
              <QueryContent query={persona} retry={() => retry('persona')}>{(active) => active ? <div className={classes.personaValue}>
                {active.hasAvatar && <LibraryAvatar className={classes.personaAvatar} src={personaAvatarUrl(active.id, active.revision)}
                  placeholder={<UserRound size={14} />} />}
                <p className={classes.value} dir="auto">{active.name}</p>
              </div> : <p className={classes.muted}>{t('home.noPersona')}</p>}</QueryContent>
            </SetupRow>
            <SetupRow icon={<NotebookText size={18} />} title={t('home.instruction')} href="#instructions" linkLabel={t('home.openInstructions')}>
              <QueryContent query={instruction} retry={() => retry('instruction')}>{(active) => active ? <>
                <p className={classes.value} dir="auto">{active.name}</p>
                {active.worldTitle && <p className={classes.muted} dir="auto">{active.worldTitle}</p>}
              </> : <p className={classes.muted}>{t('home.noInstruction')}</p>}</QueryContent>
            </SetupRow>
          </div>
        </section>

        <section className={classes.panel} aria-labelledby="home-activity">
          <PanelHeading id="home-activity" title={t('home.activity')} />
          {activity.length > 0 && <ol className={classes.activity}>
            {activity.map(({ id, label, title, updatedAt }) => <li key={`${label}:${id}`}>
              <div className={classes.activityEvent}>
                <span className={classes.muted}>{t(label)}</span>
                <strong dir="auto">{label === 'home.chatUpdated' ? chatName(title) : title}</strong>
                {time(updatedAt)}
              </div>
            </li>)}
          </ol>}
          {activityLoading ? <output className={classes.muted}>{t('home.loadingSection')}</output>
            : activityError ? <p className={classes.muted}>{t('home.activityIncomplete')}</p>
            : !activity.length && <p className={classes.muted}>{t('home.noActivity')}</p>}
        </section>
      </div>
    </div>

    <DiscardChangesDialog {...realmsNavigation.confirmation} />
  </>;
}
