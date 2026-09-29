/**
 * GitHub settings: which GitHub account this device signed in as, where the Cozea
 * GitHub App is installed, and the repositories this device linked to projects.
 */

import { useEffect, useRef, useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'

import { api } from '../../../../../convex/_generated/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from '@/features/settings/ui/SettingsChrome'
import { useGitHubConnect } from '@/features/github/useGitHubConnect'
import { useAuth } from '@/contexts/AuthContext'
import { appToast } from '@/lib/appToast'
import { cleanConvexError } from '@/lib/convexError'
import { openExternalUrl } from '@/lib/electron/shellClient'
import { useTranslation } from '@/lib/i18n'
import { githubInstallationSettingsUrl } from '@shared/github/sourceControlApp'

interface GitHubSettingsProps {
  surface?: 'page' | 'drawer'
  route?: string
}

const COMPACT_BUTTON = 'h-7 text-xs transition-[background-color,color,transform] duration-150 active:scale-[0.98]'

export function GitHubSettings({ surface = 'page' }: GitHubSettingsProps) {
  const { t } = useTranslation()
  const { isConvexAuthReady } = useAuth()
  const settings = useQuery(api.githubLinks.settings, isConvexAuthReady ? {} : 'skip')
  const disconnectAccount = useMutation(api.githubLinks.disconnectAccount)
  const syncInstallations = useAction(api.githubApp.syncInstallations)
  const github = useGitHubConnect()
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const refresh = async (quiet: boolean) => {
    setSyncing(true)
    try {
      await syncInstallations({})
    } catch (error) {
      if (!quiet) appToast.error({ title: t('settings.github.refresh'), description: cleanConvexError(error, 'Could not reach GitHub') })
    } finally {
      setSyncing(false)
    }
  }

  // Installations made before GitHub could tell Cozea about them show up after one read.
  const synced = useRef(false)
  useEffect(() => {
    if (!isConvexAuthReady || synced.current) return
    synced.current = true
    void refresh(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConvexAuthReady])

  const disconnect = async () => {
    setDisconnecting(true)
    try {
      await disconnectAccount({})
      appToast.success({ title: t('settings.github.disconnected'), description: t('settings.github.disconnectedDescription') })
    } catch (error) {
      appToast.error({ title: t('settings.github.disconnect'), description: cleanConvexError(error, 'Could not disconnect GitHub') })
    } finally {
      setDisconnecting(false)
    }
  }

  const account = settings?.account ?? null
  const installations = settings?.installations ?? []
  const repositories = settings?.repositories ?? []

  return (
    <SettingsPageBody surface={surface} className="space-y-6">
      <SettingsPageHeader title={t('settings.github.title')} />

      <section>
        <SettingsSectionTitle>{t('settings.github.accountTitle')}</SettingsSectionTitle>
        <SettingsSectionDescription>{t('settings.github.accountDescription')}</SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow>
            {settings === undefined ? (
              <SettingsRowLabel title={<Spinner size="xs" />} />
            ) : account ? (
              <SettingsRowLabel title={t('settings.github.signedInAs').replace('{login}', account.login)} />
            ) : (
              <SettingsRowLabel title={t('settings.github.notSignedIn')} description={t('settings.github.notSignedInDescription')} />
            )}
            <SettingsRowControl>
              {account ? (
                <Button type="button" variant="ghost" size="sm" className={COMPACT_BUTTON} disabled={disconnecting} onClick={() => void disconnect()}>
                  {disconnecting ? <Spinner size="xs" className="mr-1" /> : null}
                  {t('settings.github.disconnect')}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className={COMPACT_BUTTON}
                  disabled={settings === undefined || github.busy !== null}
                  onClick={() => void github.connect('sign_in')}
                >
                  {github.busy === 'sign_in' ? <Spinner size="xs" className="mr-1" /> : null}
                  {t('settings.github.signIn')}
                </Button>
              )}
            </SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>
      </section>

      <section>
        <div className="flex items-end justify-between gap-3 pb-1">
          <div className="min-w-0">
            <SettingsSectionTitle>{t('settings.github.installationsTitle')}</SettingsSectionTitle>
            <SettingsSectionDescription>{t('settings.github.installationsDescription')}</SettingsSectionDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className={COMPACT_BUTTON} disabled={syncing} onClick={() => void refresh(false)}>
              {syncing ? <Spinner size="xs" className="mr-1" /> : null}
              {t('settings.github.refresh')}
            </Button>
            <Button type="button" variant="ghost" size="sm" className={COMPACT_BUTTON} onClick={() => void github.copyInstallLink()}>
              {t('settings.github.copyInstallLink')}
            </Button>
            <Button type="button" size="sm" className={COMPACT_BUTTON} disabled={github.busy !== null} onClick={() => void github.connect('install')}>
              {github.busy === 'install' ? <Spinner size="xs" className="mr-1" /> : null}
              {t('settings.github.install')}
            </Button>
          </div>
        </div>
        <SettingsGroup>
          {installations.length === 0 ? (
            <SettingsRow>
              <p className="text-sm text-muted-foreground">{t('settings.github.noInstallations')}</p>
            </SettingsRow>
          ) : (
            installations.map((installation) => (
              <SettingsRow key={installation.installationId}>
                <SettingsRowLabel
                  title={
                    <span className="inline-flex items-center gap-2">
                      {installation.accountLogin}
                      {installation.suspended ? <Badge variant="warning">{t('settings.github.suspended')}</Badge> : null}
                    </span>
                  }
                  description={[
                    installation.accountType === 'Organization' ? t('settings.github.organization') : t('settings.github.personalAccount'),
                    installation.repositorySelection === 'all' ? t('settings.github.allRepositories') : t('settings.github.selectedRepositories'),
                  ].join(' · ')}
                />
                <SettingsRowControl>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={COMPACT_BUTTON}
                    onClick={() => void openExternalUrl(githubInstallationSettingsUrl(installation))}
                  >
                    {t('settings.github.manage')}
                  </Button>
                </SettingsRowControl>
              </SettingsRow>
            ))
          )}
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>{t('settings.github.repositoriesTitle')}</SettingsSectionTitle>
        <SettingsSectionDescription>{t('settings.github.repositoriesDescription')}</SettingsSectionDescription>
        <SettingsGroup>
          {repositories.length === 0 ? (
            <SettingsRow>
              <p className="text-sm text-muted-foreground">{t('settings.github.noRepositories')}</p>
            </SettingsRow>
          ) : (
            repositories.map((repository) => (
              <SettingsRow key={`${repository.projectId}:${repository.owner}/${repository.name}`}>
                <SettingsRowLabel title={`${repository.owner}/${repository.name}`} description={repository.projectName} />
                <SettingsRowControl>
                  {repository.usable && repository.gitWrite ? (
                    <Badge variant="success">{t('settings.github.savesToGit')}</Badge>
                  ) : (
                    <Badge variant="error">{t('settings.github.unavailable')}</Badge>
                  )}
                </SettingsRowControl>
              </SettingsRow>
            ))
          )}
        </SettingsGroup>
      </section>
    </SettingsPageBody>
  )
}
