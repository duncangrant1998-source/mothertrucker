import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchOntarioInspectionStations } from '../lib/inspectionStations';
import {
  DIMENSION_FIELDS,
  NUMERIC_FIELDS,
  toNumericOrNull,
  toFieldValue,
  findMissingDimensions
} from '../lib/vehicleProfile';

const LABEL_STYLE = {
  fontFamily: 'var(--font-display)',
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--color-text-muted)',
  display: 'block',
  marginBottom: '4px'
};

const INPUT_STYLE = {
  width: '100%',
  minHeight: '44px',
  padding: '7px 8px',
  border: '1px solid var(--color-border)',
  borderRadius: 0,
  boxSizing: 'border-box',
  background: 'var(--color-panel)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: '14px'
};

const VehicleProfile = ({ onProfileUpdate }) => {
  const [profile, setProfile] = useState({
    height: '',
    width: '',
    length: '',
    weight: '',
    axles: '2',
    load_type: 'oversize'
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  // Tone is tracked explicitly rather than sniffed from the message text — the
  // old `message.includes('Error')` check rendered 'Please log in first' green.
  const [messageTone, setMessageTone] = useState('success');
  const [invalidFields, setInvalidFields] = useState([]);
  const [syncingStations, setSyncingStations] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // maybeSingle, not single: having no profile yet is a normal state for a
      // new driver, but .single() reports it as an error — which made a genuine
      // failure (duplicate rows, network) look identical to "nothing saved yet"
      // and hid the duplicate-row bug for as long as it did.
      const { data, error } = await supabase
        .from('vehicle_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setProfile({
          ...data,
          ...Object.fromEntries(NUMERIC_FIELDS.map((f) => [f, toFieldValue(data[f])]))
        });
      }
    } catch (err) {
      console.error('Failed to load vehicle profile:', err);
    }
  };

  const showMessage = (text, tone) => {
    setMessage(text);
    setMessageTone(tone);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfile(prev => ({ ...prev, [name]: value }));
    // Drop the field's error highlight as soon as they start correcting it,
    // rather than making them press Save again to see it clear.
    setInvalidFields(prev => (prev.includes(name) ? prev.filter(f => f !== name) : prev));
  };

  const handleSave = async () => {
    // Checked before anything else: a profile missing a dimension is worse than
    // no profile at all, because Map.jsx quietly fills the gap with a default
    // and the driver has no way to tell that's what they're routing on.
    const missing = findMissingDimensions(profile);
    if (missing.length) {
      setInvalidFields(missing.map((f) => f.name));
      showMessage(`Enter ${missing.map((f) => f.label).join(', ')} before saving`, 'error');
      return;
    }
    setInvalidFields([]);
    setLoading(true);
    setMessage('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        showMessage('Please log in first', 'error');
        setLoading(false);
        return;
      }
      // Resolve the conflict on user_id, not on the primary key. The previous
      // upsert spread the whole profile object and relied on `id` being in it,
      // so any save made before a profile had loaded inserted a second row
      // rather than updating the existing one — which then broke the load
      // above and compounded on every save after that. An explicit field list
      // also keeps a loaded row's id/created_at out of the payload.
      const { axles, load_type, speed_unit } = profile;
      // Blank dimensions go to the database as NULL rather than '' (see
      // toNumericOrNull). Map.jsx then falls back to its generic defaults for
      // whichever ones are unset, exactly as it does for a driver who has
      // never saved a profile at all.
      const dimensions = Object.fromEntries(
        NUMERIC_FIELDS.map((f) => [f, toNumericOrNull(profile[f])])
      );
      const { error } = await supabase
        .from('vehicle_profiles')
        .upsert(
          {
            user_id: user.id,
            ...dimensions,
            axles,
            load_type,
            ...(speed_unit === undefined ? {} : { speed_unit }),
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
      showMessage('Profile saved!', 'success');
      // The coerced numbers, not the raw form strings, so routing works from
      // the same values that were just persisted.
      onProfileUpdate({ ...profile, ...dimensions });
      syncInspectionStationsIfEmpty();
      // Brief pause so the confirmation is actually readable before the
      // section tucks itself away.
      setTimeout(() => setExpanded(false), 800);
    } catch (err) {
      showMessage(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const syncInspectionStationsIfEmpty = async () => {
    try {
      const { count, error } = await supabase
        .from('inspection_stations')
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      if (count === 0) {
        setSyncingStations(true);
        await fetchOntarioInspectionStations();
        setSyncingStations(false);
      }
    } catch (err) {
      console.error('Failed to sync inspection stations:', err);
      setSyncingStations(false);
    }
  };

  return (
    <div style={{ fontFamily: 'var(--font-display)' }}>
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        aria-expanded={expanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          minHeight: '44px',
          boxSizing: 'border-box',
          marginBottom: '12px',
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontFamily: 'var(--font-display)'
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)' }}>
          Vehicle Profile
        </span>
        <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      <div style={{ display: 'grid', gridTemplateRows: expanded ? '1fr' : '0fr', transition: 'grid-template-rows 200ms ease-out' }}>
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          {DIMENSION_FIELDS.map(field => (
            <div key={field.name} style={{ marginBottom: '10px' }}>
              <label style={LABEL_STYLE}>
                {field.label}
              </label>
              <input
                type="number"
                name={field.name}
                value={profile[field.name]}
                onChange={handleChange}
                aria-invalid={invalidFields.includes(field.name)}
                style={invalidFields.includes(field.name)
                  ? { ...INPUT_STYLE, borderColor: '#dc2626' }
                  : INPUT_STYLE}
              />
            </div>
          ))}

          <div style={{ marginBottom: '10px' }}>
            <label style={LABEL_STYLE}>
              Axles
            </label>
            <select
              name="axles"
              value={profile.axles}
              onChange={handleChange}
              style={{ ...INPUT_STYLE, fontFamily: 'var(--font-display)', cursor: 'pointer' }}
            >
              {['2','3','4','5','6','7','8'].map(n => (
                <option key={n} value={n}>{n} axles</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={LABEL_STYLE}>
              Load Type
            </label>
            <select
              name="load_type"
              value={profile.load_type}
              onChange={handleChange}
              style={{ ...INPUT_STYLE, fontFamily: 'var(--font-display)', cursor: 'pointer' }}
            >
              <option value="oversize">Oversize</option>
              <option value="overweight">Overweight</option>
              <option value="both">Both</option>
              <option value="standard">Standard Commercial</option>
            </select>
          </div>

          <button
            onClick={handleSave}
            disabled={loading}
            style={{
              width: '100%',
              minHeight: '44px',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px',
              background: '#e85d04',
              color: 'white',
              border: 'none',
              borderRadius: 0,
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Saving…' : 'Save Profile'}
          </button>

          {message && (
            <p style={{
              marginTop: '10px',
              fontSize: '12px',
              color: messageTone === 'error' ? '#dc2626' : 'var(--color-route-normal)',
              textAlign: 'center'
            }}>
              {message}
            </p>
          )}

          {syncingStations && (
            <p style={{
              marginTop: '8px',
              fontSize: '11px',
              color: 'var(--color-text-muted)',
              textAlign: 'center'
            }}>
              Loading stations...
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default VehicleProfile;
