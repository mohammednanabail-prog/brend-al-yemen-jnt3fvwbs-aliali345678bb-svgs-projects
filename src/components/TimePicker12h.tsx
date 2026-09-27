import React, { useState, useEffect } from 'react';
import { parseTimeParts, to24hString, TimePeriod } from '../utils/time';

interface TimePicker12hProps {
  label: string;
  name: string;
  defaultValue?: string;
  icon?: string;
  description?: string;
}

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

export const TimePicker12h: React.FC<TimePicker12hProps> = ({
  label,
  name,
  defaultValue = '09:00',
  icon = 'fa-regular fa-clock',
  description,
}) => {
  const initial = parseTimeParts(defaultValue, name === 'hoursClose' ? 10 : 9, name === 'hoursClose' ? 'PM' : 'AM');
  const [hour, setHour] = useState<number>(initial.hour12);
  const [minute, setMinute] = useState<string>(initial.minute);
  const [period, setPeriod] = useState<TimePeriod>(initial.period);

  useEffect(() => {
    if (defaultValue) {
      const p = parseTimeParts(defaultValue, name === 'hoursClose' ? 10 : 9, name === 'hoursClose' ? 'PM' : 'AM');
      setHour(p.hour12);
      setMinute(p.minute);
      setPeriod(p.period);
    }
  }, [defaultValue, name]);

  const value24 = to24hString(hour, minute, period);
  const formattedArabic = `${hour}:${minute} ${period === 'AM' ? 'صباحاً (ص)' : 'مساءً (م)'}`;

  return (
    <div className="time-picker-12h" style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <label className="lbl" style={{ margin: 0, fontWeight: 700 }}>
          <i className={icon} style={{ color: 'var(--gold)', marginLeft: '6px' }}></i>
          {label}
        </label>
        <span
          style={{
            fontSize: '11px',
            color: 'var(--gold)',
            background: 'rgba(212, 175, 55, 0.12)',
            padding: '2px 8px',
            borderRadius: '12px',
            border: '1px solid rgba(212, 175, 55, 0.25)',
            fontWeight: 600,
          }}
        >
          نظام 12 ساعة
        </span>
      </div>

      {/* حقل مخفي لإرسال القيمة المتوافقة قياسياً مع النموذج والباك إند */}
      <input type="hidden" name={name} value={value24} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr 1.4fr',
          gap: '6px',
          alignItems: 'center',
          background: '#0d0d10',
          padding: '8px',
          borderRadius: '12px',
          border: '1.5px solid var(--inp-border)',
        }}
      >
        {/* اختيار الساعة */}
        <select
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
          className="inp"
          style={{
            padding: '8px 6px',
            textAlign: 'center',
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          aria-label={`${label} - الساعة`}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h < 10 ? `0${h}` : h}
            </option>
          ))}
        </select>

        {/* فاصل التوقيت */}
        <span style={{ fontWeight: 800, fontSize: '18px', color: 'var(--gold)', userSelect: 'none' }}>:</span>

        {/* اختيار الدقيقة */}
        <select
          value={minute}
          onChange={(e) => setMinute(e.target.value)}
          className="inp"
          style={{
            padding: '8px 6px',
            textAlign: 'center',
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          aria-label={`${label} - الدقيقة`}
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          {/* إذا كانت هناك دقيقة خاصة غير موجودة في القائمة */}
          {!MINUTES.includes(minute) && <option value={minute}>{minute}</option>}
        </select>

        {/* زر الفترة: صباحاً / مساءً */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
          <button
            type="button"
            onClick={() => setPeriod('AM')}
            style={{
              padding: '8px 4px',
              fontSize: '12px',
              fontWeight: 700,
              borderRadius: '8px',
              border: period === 'AM' ? '1px solid var(--gold)' : '1px solid #2a2a32',
              background: period === 'AM' ? 'var(--gold)' : '#16161b',
              color: period === 'AM' ? '#000' : 'var(--muted)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            صباحاً
          </button>
          <button
            type="button"
            onClick={() => setPeriod('PM')}
            style={{
              padding: '8px 4px',
              fontSize: '12px',
              fontWeight: 700,
              borderRadius: '8px',
              border: period === 'PM' ? '1px solid var(--gold)' : '1px solid #2a2a32',
              background: period === 'PM' ? 'var(--gold)' : '#16161b',
              color: period === 'PM' ? '#000' : 'var(--muted)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            مساءً
          </button>
        </div>
      </div>

      {/* ملخص الوقت المحدد */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '6px',
          padding: '4px 10px',
          background: 'rgba(212, 175, 55, 0.06)',
          borderRadius: '8px',
          fontSize: '12px',
        }}
      >
        <span style={{ color: 'var(--muted)' }}>
          {description || (name === 'hoursOpen' ? 'وقت بدء استقبال الطلبات' : 'وقت التوقف عن استقبال الطلبات')}
        </span>
        <span style={{ color: 'var(--gold-l)', fontWeight: 700, direction: 'rtl' }}>
          {formattedArabic}
        </span>
      </div>
    </div>
  );
};
