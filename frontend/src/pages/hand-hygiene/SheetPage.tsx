import { useQuery } from '@tanstack/react-query';
import { listStaffCategories } from '../../api/masters';

const MOMENTS = [
  '1 Before patient',
  '2 Before aseptic',
  '3 After body fluid',
  '4 After patient',
  '5 After surroundings',
];
const ROWS = Array.from({ length: 12 }, (_, i) => i + 1);

const Box = () => <span className="box" aria-hidden="true" />;

export function SheetPage() {
  const cats = useQuery({
    queryKey: ['masters', 'staff-categories', 'sheet'],
    queryFn: () => listStaffCategories({ status: 'Active', page_size: 500 }),
  });
  const items = cats.data?.items ?? [];

  return (
    <>
      <section className="card no-print">
        <div className="row between">
          <h1>Printable observation sheet</h1>
          <button type="button" className="btn ghost sm" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>
        <p className="muted small">
          Matches the entry screen row for row, so typing it in is quick. A server-generated PDF
          arrives in a later slice; for now use your browser&apos;s print dialog.
        </p>
        {cats.isError && (
          <p role="alert" className="err">
            Could not load the staff categories. The category codes below may be missing.
          </p>
        )}
      </section>

      <section className="card print-area" aria-label="Observation sheet">
        <div className="sheet">
          <div style={{ textAlign: 'center' }}>
            <strong style={{ fontSize: '1rem' }}>
              SRI NARAYANI HOSPITAL &amp; RESEARCH CENTRE
            </strong>
            <br />
            Hand Hygiene Observation Sheet (WHO 5 Moments)
          </div>
          <p>
            Session no: HH-______ &nbsp; Ward: ______________ &nbsp; Date: __/__/____ &nbsp; Start:
            __:__ &nbsp; End: __:__ &nbsp; Observer: ____________
          </p>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">
                    Category
                    <br />
                    <span style={{ fontWeight: 400 }}>{items.map((c) => c.code).join(' ')}</span>
                  </th>
                  <th scope="col">Moment(s) 1–5</th>
                  <th scope="col">
                    Action
                    <br />
                    <span style={{ fontWeight: 400 }}>Rub / Wash / Missed</span>
                  </th>
                  <th scope="col">Gloves</th>
                  <th scope="col">Technique</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((n) => (
                  <tr key={n}>
                    <td>{n}</td>
                    <td>
                      {items.map((c) => (
                        <span key={c.id} className="cell">
                          {c.code}
                          <Box />
                        </span>
                      ))}
                    </td>
                    <td>
                      {[1, 2, 3, 4, 5].map((m) => (
                        <span key={m} className="cell">
                          {m}
                          <Box />
                        </span>
                      ))}
                    </td>
                    <td>
                      {['R', 'W', 'M'].map((a) => (
                        <span key={a} className="cell">
                          {a}
                          <Box />
                        </span>
                      ))}
                    </td>
                    <td>
                      {['Y', 'N'].map((a) => (
                        <span key={a} className="cell">
                          {a}
                          <Box />
                        </span>
                      ))}
                    </td>
                    <td>
                      {['Y', 'N'].map((a) => (
                        <span key={a} className="cell">
                          {a}
                          <Box />
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {items.map((c) => `${c.code} ${c.name}`).join(' · ')}
            {items.length > 0 && <>&nbsp;|&nbsp;</>}
            {MOMENTS.join(' · ')}
          </p>
          <p>Signature of observer: ______________________</p>
        </div>
      </section>
    </>
  );
}
