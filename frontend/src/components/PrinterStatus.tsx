import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Btn, Modal, Tag, useToast } from '@/components/ui'
import { usePrintStatus } from '@/lib/printing/usePrintStatus'
import { cancelPrintJob, confirmJobPrinted, printJobViaBrowser, resendPrintJob, retryPrintQueue } from '@/lib/printing/service'

/**
 * Status-bar printer indicator. Silent when everything is fine; when something
 * needs a person it says what, and the dialog holds the only controls a cashier
 * ever needs: retry, print this one another way, or confirm a receipt that
 * may or may not have come out.
 */
export default function PrinterStatus() {
  const h = usePrintStatus()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  if (h.level === 'off' && h.queue.jobs.length === 0) return null

  return (
    <>
      <button type="button" className={`ps-chip ps-${h.level}`} onClick={() => setOpen(true)} title={h.action || h.label} aria-label={`Printer status: ${h.label}`}>
        <span className="ps-dot" aria-hidden />
        <span className="ps-label">{h.label}</span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Printer status"
        ariaLabel="Printer status"
        width={520}
        footer={
          <>
            <Btn variant="secondary" onClick={() => { setOpen(false); navigate('/settings') }}>
              Printer settings
            </Btn>
            <Btn variant="primary" onClick={() => setOpen(false)}>
              Close
            </Btn>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <div className={`ps-banner ps-${h.level}`}>
            <strong>{h.label}</strong>
            {h.action && <div>{h.action}</div>}
            {h.bridge.printer && <div className="t-caption">Printer: {h.bridge.printer}</div>}
            {h.queue.lastError && h.level !== 'ok' && <div className="t-caption">Last error: {h.queue.lastError}</div>}
          </div>
          {h.queue.jobs.length === 0 ? (
            <div className="t-caption">Nothing is waiting to print.</div>
          ) : (
            <ul className="ps-jobs">
              {h.queue.jobs.map((j) => (
                <li key={j.id} className="ps-job">
                  <div className="ps-job-head">
                    <span className="ps-job-name">{j.label}</span>
                    <Tag kind={j.status === 'uncertain' ? 'warn' : 'blue'}>{j.status === 'uncertain' ? 'CHECK PAPER' : j.status === 'printing' ? 'PRINTING' : 'WAITING'}</Tag>
                  </div>
                  {j.lastError && <div className="t-caption">{j.lastError}</div>}
                  <div className="ps-job-actions">
                    {j.status === 'uncertain' ? (
                      <>
                        <Btn sm variant="secondary" onClick={() => void confirmJobPrinted(j.id)}>
                          It printed
                        </Btn>
                        <Btn sm variant="secondary" onClick={() => void resendPrintJob(j.id)}>
                          Print again
                        </Btn>
                      </>
                    ) : (
                      <>
                        <Btn
                          sm
                          variant="secondary"
                          onClick={async () => {
                            if (!(await printJobViaBrowser(j))) toast('Allow pop-ups to print through the browser.', 'err')
                          }}
                        >
                          Print via browser
                        </Btn>
                        <Btn sm variant="ghost" onClick={() => void cancelPrintJob(j.id)}>
                          Discard
                        </Btn>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {h.queue.pending > 0 && (
            <Btn variant="primary" onClick={() => void retryPrintQueue()}>
              Retry now
            </Btn>
          )}
        </div>
      </Modal>
    </>
  )
}
