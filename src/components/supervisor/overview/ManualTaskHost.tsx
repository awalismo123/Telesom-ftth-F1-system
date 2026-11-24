import React, { useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { fetchDispatchLoad, toTargets } from '../../../lib/dispatchService';
import type { DispatchTarget } from '../../../lib/dispatch';
import { fetchGroupOverview } from '../../../lib/reads';
import { ManualTaskSheet } from '../dispatch/ManualTaskSheet';

/**
 * Adding a job from a phone call, from the command page.
 *
 * The supervisor is on the line to a customer and needs to write the job down
 * *now*; making them switch to Dispatch first is how the call ends up on a scrap
 * of paper. This loads only the two things the sheet needs — the target list and
 * the known box codes — and only once somebody asks for it.
 */
export function ManualTaskHost({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { session, activeGroup } = useAuth();
  const [targets, setTargets] = useState<DispatchTarget[]>([]);
  const [boxCodes, setBoxCodes] = useState<{ box_code: string; total_ports: number }[]>([]);

  const token = session?.token ?? '';
  const groupId = activeGroup?.id ?? '';

  useEffect(() => {
    if (!open || !token || !groupId) return;
    let cancelled = false;

    void Promise.all([fetchDispatchLoad(token, groupId), fetchGroupOverview(token, groupId)])
      .then(([load, overview]) => {
        if (cancelled) return;
        setTargets(toTargets(load));
        setBoxCodes(
          overview.cableboxes.map((box) => ({
            box_code: box.box_code,
            total_ports: box.total_ports,
          })),
        );
      })
      .catch(() => {
        // The sheet still works without suggestions: a supervisor can type a box
        // code and assign later. Failing here must not block the call.
      });

    return () => {
      cancelled = true;
    };
  }, [open, token, groupId]);

  if (!open) return null;

  return (
    <ManualTaskSheet
      open={open}
      onClose={onClose}
      token={token}
      groupId={groupId}
      targets={targets}
      boxCodes={boxCodes}
      onCreated={() => {
        onCreated();
        onClose();
      }}
    />
  );
}
