import { useRef, useState } from 'react';

import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { useCurrentProfile } from '@/features/profiles/hooks/use-current-profile';
import { useProfileMutations } from '@/features/profiles/mutations/use-profile-mutations';
import { useProfiles } from '@/features/profiles/queries/use-profiles';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Field, FieldGroup } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

export const SelectProfileDialog = () => {
  const { t } = useI18n();
  const { data } = useProfiles();
  const currentProfile = useCurrentProfile();
  const { mode, close, setMode } = useDialog();
  const open = mode === 'select-profile';
  const { mutateAsync } = useProfileMutations();

  const [newProfile, setNewProfile] = useState(currentProfile);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const closeDialog = () => {
    setDeleteArmed(false);
    close();
  };

  const profiles = data?.profiles ?? [];

  const containerRef = useRef<HTMLDivElement>(null);
  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 5,
    onBack: closeDialog,
    containerRef,
  });

  const deleteProfile = async (): Promise<void> => {
    setDeleteArmed(false);
    if (typeof newProfile !== 'string' || newProfile === '') {
      return;
    }

    await mutateAsync({ name: newProfile, type: 'delete' });
    close();
  };

  const switchProfile = async (): Promise<void> => {
    if (typeof newProfile !== 'string' || newProfile === '') {
      close();
      return;
    }

    await mutateAsync({ name: newProfile, type: 'switch' });
    close();
  };

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="sm:max-w-sm">
        <div ref={containerRef} className="contents">
          <DialogHeader>
            <DialogTitle>{t('profile.selectTitle')}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <Label htmlFor="model-1">{t('result.profile')}</Label>
              <Select
                onValueChange={(profile) => {
                  setNewProfile(profile);
                  setDeleteArmed(false);
                }}
                defaultValue={currentProfile}
              >
                <SelectTrigger
                  id="model-1"
                  className={cn(
                    'focus-visible:ring-0 focus-visible:border-transparent',
                    focusedIndex === 0 && 'ring-2 ring-primary',
                  )}
                >
                  <SelectValue placeholder={t('profile.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t('result.profile')}</SelectLabel>
                    {profiles.map((profile) => (
                      <SelectItem key={profile} value={profile}>
                        {profile}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                variant="outline"
                onClick={closeDialog}
                className={cn(
                  'focus-visible:ring-0 focus-visible:border-transparent',
                  focusedIndex === 1 && 'ring-2 ring-primary',
                )}
              >
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <Button
              variant="outline"
              onClick={() => setMode('create-profile')}
              className={cn(
                'focus-visible:ring-0 focus-visible:border-transparent',
                focusedIndex === 2 && 'ring-2 ring-primary',
              )}
            >
              {t('profile.createNew')}
            </Button>
            <Button
              variant="destructive"
              disabled={typeof newProfile !== 'string' || newProfile === ''}
              onClick={() => (deleteArmed ? void deleteProfile() : setDeleteArmed(true))}
              className={cn(
                'focus-visible:ring-0 focus-visible:border-transparent',
                focusedIndex === 3 && 'ring-2 ring-primary',
              )}
            >
              {deleteArmed ? t('profile.confirmDelete') : t('profile.delete')}
            </Button>
            <Button
              disabled={newProfile === currentProfile}
              onClick={() => void switchProfile()}
              className={cn(
                'focus-visible:ring-0 focus-visible:border-transparent',
                focusedIndex === 4 && 'ring-2 ring-primary',
              )}
            >
              {t('profile.select')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
