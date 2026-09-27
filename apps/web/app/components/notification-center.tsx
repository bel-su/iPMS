'use client';

import React, { useState } from 'react';

export interface NotificationItem {
  id: string;
  category: 'work-order' | 'qc' | 'system';
  title: string;
  description: string;
  time: string;
  unread: boolean;
  href?: string;
}

const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-1',
    category: 'qc',
    title: 'Submission Awaiting QC Review',
    description: 'Work order #WO-104 (5G Massive MIMO) submitted with 2 watermarked photos.',
    time: '5m ago',
    unread: true,
    href: '/quality/work-orders',
  },
  {
    id: 'notif-2',
    category: 'work-order',
    title: 'Checklist Rework Required',
    description: 'Tower foundation check #WO-098 sent back for rework: Missing slump test photo.',
    time: '42m ago',
    unread: true,
    href: '/quality/work-orders',
  },
  {
    id: 'notif-3',
    category: 'system',
    title: 'Site Geofence Verified',
    description: 'Field engineer checked in at Site KOS121 within 8.5m accuracy.',
    time: '2h ago',
    unread: true,
    href: '/projects',
  },
  {
    id: 'notif-4',
    category: 'qc',
    title: 'Quality Check Approved',
    description: 'Substation civil foundation inspection passed full QC verification.',
    time: '5h ago',
    unread: false,
    href: '/quality/work-orders',
  },
];

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'work-order' | 'qc'>('all');
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);

  const unreadCount = notifications.filter((n) => n.unread).length;
  const filtered = notifications.filter((n) => filter === 'all' || n.category === filter);

  function markAllAsRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
  }

  function markAsRead(id: string) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, unread: false } : n)),
    );
  }

  return (
    <div className="notif-wrapper">
      <button
        type="button"
        className={`notif-bell-btn${open ? ' active' : ''}`}
        onClick={() => setOpen(!open)}
        aria-label={`Notifications, ${unreadCount} unread`}
        title="Notifications"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>

        {unreadCount > 0 ? (
          <span className="notif-badge" aria-hidden="true">
            {unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div
            className="notif-backdrop"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="notif-dropdown" role="dialog" aria-label="Notifications panel">
            <div className="notif-header">
              <div className="notif-header-title">
                <h3>Notifications</h3>
                {unreadCount > 0 ? (
                  <span className="notif-count-pill">{unreadCount} new</span>
                ) : null}
              </div>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  className="notif-mark-read-btn"
                  onClick={markAllAsRead}
                >
                  Mark all as read
                </button>
              ) : null}
            </div>

            <div className="notif-tabs" role="tablist">
              <button
                type="button"
                className={`notif-tab${filter === 'all' ? ' active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`notif-tab${filter === 'qc' ? ' active' : ''}`}
                onClick={() => setFilter('qc')}
              >
                Quality & QC
              </button>
              <button
                type="button"
                className={`notif-tab${filter === 'work-order' ? ' active' : ''}`}
                onClick={() => setFilter('work-order')}
              >
                Work Orders
              </button>
            </div>

            <div className="notif-list">
              {filtered.length === 0 ? (
                <div className="notif-empty">
                  <div className="notif-empty-icon" aria-hidden="true">✓</div>
                  <p>All caught up!</p>
                  <span>No unread notifications in this category.</span>
                </div>
              ) : (
                filtered.map((item) => (
                  <a
                    key={item.id}
                    href={item.href ?? '#'}
                    className={`notif-item${item.unread ? ' unread' : ''}`}
                    onClick={() => {
                      markAsRead(item.id);
                      setOpen(false);
                    }}
                  >
                    <div className="notif-item-left">
                      <span className={`notif-dot ${item.category}`} aria-hidden="true" />
                    </div>
                    <div className="notif-item-content">
                      <div className="notif-item-row">
                        <span className="notif-item-title">{item.title}</span>
                        <span className="notif-item-time">{item.time}</span>
                      </div>
                      <p className="notif-item-desc">{item.description}</p>
                    </div>
                  </a>
                ))
              )}
            </div>

            <div className="notif-footer">
              <a href="/quality/work-orders" onClick={() => setOpen(false)}>
                View all work orders &rarr;
              </a>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
