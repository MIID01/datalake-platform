$services = gcloud run services list --region=me-central2 --format="value(name)"
$services = $services -split "`n"

$exclude = @("datalake-ocr", "datalake-ai-inference", "datalake-cv-agent", "zohopaymentwebhook", "submitcareerapplication", "getbackfillconsentform", "submitbackfillconsent", "getclientscorecardform", "submitclientscorecard")

foreach ($svc in $services) {
    $svc = $svc.Trim()
    if ([string]::IsNullOrWhiteSpace($svc)) { continue }
    if ($exclude -contains $svc) {
        Write-Host "Skipping $svc"
        continue
    }

    Write-Host "Applying bindings to $svc..."
    # Suppress errors if allUsers is not present
    gcloud run services remove-iam-policy-binding $svc --region=me-central2 --member="allUsers" --role="roles/run.invoker" 2>$null
    gcloud run services add-iam-policy-binding $svc --region=me-central2 --member="domain:datalake.sa" --role="roles/run.invoker" 2>$null
}
Write-Host "Done!"
