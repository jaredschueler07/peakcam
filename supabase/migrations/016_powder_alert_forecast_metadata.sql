-- PeakCam — Forecast powder alert deduplication metadata

alter table powder_alert_log
  add column if not exists kind text not null default 'live';

alter table powder_alert_log
  add column if not exists storm_start_date date;

alter table powder_alert_log
  drop constraint if exists powder_alert_log_kind_check;

alter table powder_alert_log
  add constraint powder_alert_log_kind_check check (kind in ('live', 'forecast'));

alter table powder_alert_log
  drop constraint if exists powder_alert_log_subscriber_id_resort_id_alert_date_key;

create unique index if not exists powder_alert_log_event_key
  on powder_alert_log (
    subscriber_id,
    resort_id,
    alert_date,
    kind,
    coalesce(storm_start_date, '0001-01-01'::date),
    new_snow_inches
  );

create index if not exists powder_alert_log_forecast_idx
  on powder_alert_log (subscriber_id, resort_id, kind, storm_start_date, alert_date);
