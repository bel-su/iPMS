'use client';
import { useState } from 'react';
import { useActionStateWithToast } from '../components/toast';
import { useFormStatus } from 'react-dom';
import { updateMyProfileAction } from '../users/actions';
import { EMPTY, type FormState } from '../lib/form-state';
import type { User } from '../lib/user-api';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" type="submit" disabled={pending}>
      {pending ? 'Saving changes…' : 'Save profile changes'}
    </button>
  );
}

function FormStatusMessage({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <div className="profile-banner error" role="alert">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>{state.error}</span>
      </div>
    );
  }
  if (state.done) {
    return (
      <div className="profile-banner success" role="status">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>Profile updated successfully!</span>
      </div>
    );
  }
  return null;
}

export function ProfileManager({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<'details' | 'security' | 'roles'>('details');
  const [state, action] = useActionStateWithToast(updateMyProfileAction, EMPTY, 'Profile saved');

  return (
    <div className="profile-container">
      {/* Profile Tab Navigation */}
      <div className="profile-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'details'}
          className={`profile-tab${activeTab === 'details' ? ' active' : ''}`}
          onClick={() => setActiveTab('details')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          Edit Profile
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'security'}
          className={`profile-tab${activeTab === 'security' ? ' active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Security &amp; Credentials
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'roles'}
          className={`profile-tab${activeTab === 'roles' ? ' active' : ''}`}
          onClick={() => setActiveTab('roles')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          Roles &amp; Authority
        </button>
      </div>

      {/* Tab 1: Edit Profile Details */}
      {activeTab === 'details' ? (
        <section className="panel profile-panel">
          <div className="panel-header">
            <div>
              <h2>Personal Information</h2>
              <p>Manage your account name, email address, and employee identifier.</p>
            </div>
          </div>

          <form action={action} className="profile-form">
            <FormStatusMessage state={state} />

            <div className="form-grid">
              <label className="field">
                Full name
                <input
                  name="fullName"
                  required
                  defaultValue={user.fullName}
                  maxLength={200}
                  placeholder="e.g. Jane Doe"
                />
                <span className="hint">Your legal or display name within Axiom.</span>
              </label>

              <label className="field">
                Email address
                <input
                  name="email"
                  type="email"
                  required
                  defaultValue={user.email}
                  maxLength={255}
                  placeholder="name@company.com"
                />
                <span className="hint">Used for sign-in and platform notifications.</span>
              </label>

              <label className="field">
                Employee code
                <input
                  name="employeeCode"
                  defaultValue={user.employeeCode ?? ''}
                  maxLength={50}
                  placeholder="e.g. EMP-1042"
                />
                <span className="hint">Field badge or internal company identifier.</span>
              </label>
            </div>

            <div className="profile-form-footer">
              <SubmitButton />
              <p className="form-note-inline">
                Changes are saved directly to your Axiom identity account.
              </p>
            </div>
          </form>
        </section>
      ) : null}

      {/* Tab 2: Security & Credentials */}
      {activeTab === 'security' ? (
        <section className="panel profile-panel">
          <div className="panel-header">
            <div>
              <h2>Security &amp; Login Credentials</h2>
              <p>Review authentication settings, change password, and view session status.</p>
            </div>
          </div>

          <div className="security-cards-grid">
            <div className="security-card">
              <div className="security-card-icon key-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 2l-2 2m-1.5 1.5L14 9l-3 3-4-4 3-3 3.5-3.5" />
                  <path d="m15.5 7.5 3 3" />
                  <circle cx="7.5" cy="16.5" r="5.5" />
                  <path d="m5 19 2-2" />
                </svg>
              </div>
              <div className="security-card-content">
                <h3>Password</h3>
                <p>Change your password regularly to maintain high field operations security.</p>
                <div className="security-card-action">
                  <a className="primary-button" href="/change-password">
                    Change password
                  </a>
                </div>
              </div>
            </div>

            <div className="security-card">
              <div className="security-card-icon shield-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <div className="security-card-content">
                <h3>Session &amp; Token Status</h3>
                <p>Active cryptographic JWT session with token rotation enforcement.</p>
                <div className="security-metrics">
                  <div>
                    <span className="subtle">Account Status:</span>
                    <strong className="status-badge-inline active">Active</strong>
                  </div>
                  <div>
                    <span className="subtle">Must Change Password:</span>
                    <span>{user.mustChangePassword ? 'Yes (Pending)' : 'No (Compliant)'}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="security-card">
              <div className="security-card-icon bio-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 11c0 3.5-2.5 6-5 6" />
                  <path d="M17 12c0 4.5-3.5 8-8 8" />
                  <path d="M12 2a10 10 0 0 0-10 10c0 3.5 1.5 6.5 4 8" />
                  <path d="M14 6a7 7 0 0 1 7 7c0 2-.5 4-1.5 5.5" />
                  <path d="M9 14c0 1.5 1 2.5 2.5 2.5s2.5-1 2.5-2.5" />
                </svg>
              </div>
              <div className="security-card-content">
                <h3>Mobile Biometrics</h3>
                <p>Fingerprint biometric authentication can be enabled on your Axiom Mobile app for quick sign-in.</p>
                <div className="bio-pill">
                  <span className="pulse-dot" />
                  <span>Configured via Mobile App</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Tab 3: Roles & Authority */}
      {activeTab === 'roles' ? (
        <section className="panel profile-panel">
          <div className="panel-header">
            <div>
              <h2>Assigned Roles &amp; Access</h2>
              <p>Your current platform permissions and project responsibilities.</p>
            </div>
          </div>

          <div className="roles-detail-section">
            <div className="role-chip-container">
              {user.roles.length > 0 ? (
                user.roles.map((role) => (
                  <div key={role.code} className="role-detail-card">
                    <div className="role-detail-badge">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </div>
                    <div>
                      <strong className="role-title">{role.name}</strong>
                      <code className="role-code">{role.code}</code>
                    </div>
                  </div>
                ))
              ) : (
                <p className="subtle">No roles assigned.</p>
              )}
            </div>

            <div className="roles-policy-note">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>
                To request additional module permissions or project assignments, contact your project manager or system administrator.
              </span>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
