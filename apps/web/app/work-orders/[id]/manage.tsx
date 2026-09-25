'use client';
import { useActionState, useState } from 'react';
import { EMPTY } from '../../lib/form-state';
import { FormError, SubmitButton } from '../../projects/forms';
import { cancelWorkOrderAction, updateWorkOrderAction } from '../actions';
import { endOfDayIso, isoDay } from '../labels';

/**
 * The three things a coordinator does to open work: hand it to someone else,
 * move its date, or call it off. Each is its own small form so one refusal
 * does not clear the others.
 */
export function ManageWorkOrder({ id, projectId, assigneeId, plannedDay, people, canAssign, canCancel }: {
  id: string;
  projectId: string;
  assigneeId: string | null;
  plannedDay: string;
  people: { id: string; label: string }[];
  canAssign: boolean;
  canCancel: boolean;
}) {
  const [reassignState, reassign] = useActionState(updateWorkOrderAction, EMPTY);
  const [rescheduleState, reschedule] = useActionState(updateWorkOrderAction, EMPTY);
  const [cancelState, cancel] = useActionState(cancelWorkOrderAction, EMPTY);
  const [day, setDay] = useState(plannedDay);
  const [confirming, setConfirming] = useState(false);
  const others = people.filter((p) => p.id !== assigneeId);

  return (
    <div className="manage">
      {canAssign
        ? <>
            <form action={reassign} className="manage-block">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="projectId" value={projectId} />
              <label htmlFor="reassign">Hand over to</label>
              <div className="manage-row">
                <select id="reassign" name="assigneeId" defaultValue="" required>
                  <option value="" disabled>{others.length ? 'Choose a person' : 'Nobody else can open this site'}</option>
                  {others.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <SubmitButton className="ghost-button">Reassign</SubmitButton>
              </div>
              <FormError state={reassignState} />
            </form>
            <form action={reschedule} className="manage-block">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="plannedCompletionAt" value={endOfDayIso(day) ?? ''} />
              <label htmlFor="reschedule">Planned completion</label>
              <div className="manage-row">
                <input id="reschedule" type="date" value={day} min={isoDay(new Date())} onChange={(e) => setDay(e.target.value)} required />
                <SubmitButton className="ghost-button">Move date</SubmitButton>
              </div>
              <FormError state={rescheduleState} />
            </form>
          </>
        : null}
      {canCancel
        ? <form action={cancel} className="manage-block danger">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="projectId" value={projectId} />
            {confirming
              ? <>
                  <label htmlFor="reason">Why is it being cancelled?</label>
                  <textarea id="reason" name="reason" rows={2} minLength={3} maxLength={500} required placeholder="e.g. Site handed back to the client" />
                  <div className="manage-row">
                    <SubmitButton className="danger-button">Cancel work order</SubmitButton>
                    <button type="button" className="link-button" onClick={() => setConfirming(false)}>Keep it</button>
                  </div>
                </>
              : <button type="button" className="link-button danger" onClick={() => setConfirming(true)}>Cancel this work order…</button>}
            <FormError state={cancelState} />
          </form>
        : null}
    </div>
  );
}
