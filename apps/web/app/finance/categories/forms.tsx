'use client';
import { FormError, RowAction, SubmitButton } from '../../components/forms';
import { useActionStateWithToast } from '../../components/toast';
import { EMPTY } from '../../lib/form-state';
import type { ExpenseCategory } from '../../lib/finance-api';
import { createCategoryAction, updateCategoryAction } from '../actions';

export function CreateCategoryForm() {
  const [state, action] = useActionStateWithToast(createCategoryAction, EMPTY, 'Category added');
  return (
    <form action={action} className="inline-form">
      <label className="field">Code<input name="code" required pattern="[A-Za-z0-9_]{2,30}" maxLength={30} /></label>
      <label className="field">Name<input name="name" required maxLength={100} /></label>
      <SubmitButton>Add category</SubmitButton>
      <FormError state={state} />
    </form>
  );
}

export function CategoryRow({ category }: { category: ExpenseCategory }) {
  const [state, action] = useActionStateWithToast(updateCategoryAction, EMPTY, 'Category saved');
  const isDisabled = category.disabledAt !== null;
  return (
    <tr>
      <td><strong>{category.code}</strong></td>
      <td>
        <form action={action} className="inline-form">
          <input type="hidden" name="id" value={category.id} />
          <label className="field"><input name="name" defaultValue={category.name} required maxLength={100} aria-label={`Name of ${category.code}`} /></label>
          <SubmitButton className="ghost-button">Save</SubmitButton>
          <FormError state={state} />
        </form>
      </td>
      <td>{isDisabled ? <span className="finance-pill slate">Disabled</span> : <span className="finance-pill green">In use</span>}</td>
      <td>
        <RowAction
          action={updateCategoryAction}
          hidden={{ id: category.id, disabled: String(!isDisabled) }}
          label={isDisabled ? 'Enable' : 'Disable'}
          success={isDisabled ? 'Category enabled' : 'Category disabled'}
          className="ghost-button"
        />
      </td>
    </tr>
  );
}
