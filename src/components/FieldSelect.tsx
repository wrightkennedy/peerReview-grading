interface FieldSelectProps {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}

export function FieldSelect({
  label,
  options,
  value,
  onChange,
  required = false,
}: FieldSelectProps) {
  return (
    <label className="field-select">
      <span className="label-row">
        {label}
        {required ? <em className="required">required</em> : null}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {!options.includes(value) ? <option value={value}>{value || '(unset)'}</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
